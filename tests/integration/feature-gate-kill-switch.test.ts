import { describe, it, expect } from 'vitest';
import {
  createInMemoryControlPlane,
  createAgentActor,
  ManualClock,
  capability,
  StaticFeatureGate,
  agentEnabledFlag,
  type ExecutionAdapter,
  type ExecutionRequest,
  type ExecutionResult,
} from '../../src/index.js';

/** An adapter that records whether it was ever asked to execute. */
class SpyAdapter implements ExecutionAdapter {
  readonly name = 'spy';
  calls = 0;
  canHandle(): boolean {
    return true;
  }
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    this.calls += 1;
    const now = new Date().toISOString();
    return {
      status: 'succeeded',
      output: { echoed: request.command.name },
      executor: this.name,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      cost: { units: 0 },
      metadata: {},
    };
  }
}

const OUTREACH = capability('revenue.outreach');

/** A revenue-domain agent that is otherwise cleared to run OUTREACH at R1. */
function revenueAgent() {
  return createAgentActor({
    name: 'Outreacher',
    purpose: 'send outreach',
    owner: 'growth',
    domain: 'revenue',
    role: 'outreach',
    permissions: [OUTREACH],
    defaultRiskLevel: 'R1',
    maxRiskLevel: 'R3',
  });
}

/** The risk config that would otherwise let the command through as ALLOW. */
const R1_OUTREACH = { risk: { capabilityRisk: { 'revenue.outreach': 'R1' as const } } };

describe('FeatureGate kill-switch (ADR-010 Phase 2)', () => {
  it('withholds a switched-off agent BEFORE policy or execution', async () => {
    const spy = new SpyAdapter();
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1_OUTREACH,
      adapters: [spy],
      featureGate: new StaticFeatureGate({
        flags: { [agentEnabledFlag('revenue')]: false },
      }),
    });

    const outcome = await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: revenueAgent(),
      capability: OUTREACH,
    });

    expect(outcome.status).toBe('denied');
    expect(outcome.run.state).toBe('denied');
    expect(outcome.result).toBeUndefined();
    expect(spy.calls).toBe(0); // never reached execution

    // Denial is a rollout kill-switch, NOT an authority decision — the distinct
    // policyId keeps the reliability ledger honest about why the run stopped.
    expect(outcome.decision.decision).toBe('DENY');
    expect(outcome.decision.policyId).toBe('feature-gate.kill-switch');
    expect(outcome.decision.reason).toContain('kill-switch');

    // The gate rejects the command before the policy engine ever runs, so the
    // fact stream is command.received → command.rejected (no policy.* events).
    expect(plane.eventSink.typeSequence()).toEqual([
      'command.received',
      'command.rejected',
    ]);
    const rejected = plane.eventSink.ofType('command.rejected')[0];
    expect(rejected?.payload).toMatchObject({
      flag: agentEnabledFlag('revenue'),
      gate: 'feature-gate',
    });

    // Telemetry records the denial and tags the kill-switch flag.
    const denied = plane.telemetrySink
      .forRun(outcome.run.runId)
      .find((t) => t.status === 'denied');
    expect(denied?.decision).toBe('DENY');
    expect(denied?.metadata).toMatchObject({ killSwitch: agentEnabledFlag('revenue') });
  });

  it('lets a switched-ON agent proceed to normal execution', async () => {
    const spy = new SpyAdapter();
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1_OUTREACH,
      adapters: [spy],
      featureGate: new StaticFeatureGate({
        flags: { [agentEnabledFlag('revenue')]: true },
      }),
    });

    const outcome = await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: revenueAgent(),
      capability: OUTREACH,
    });

    expect(outcome.status).toBe('completed');
    expect(outcome.decision.decision).toBe('ALLOW');
    expect(spy.calls).toBe(1);
    expect(plane.eventSink.typeSequence()).toEqual([
      'command.received',
      'policy.allowed',
      'execution.started',
      'execution.completed',
    ]);
  });

  it("does not block on another domain's kill-switch", async () => {
    const spy = new SpyAdapter();
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1_OUTREACH,
      adapters: [spy],
      featureGate: new StaticFeatureGate({
        flags: { [agentEnabledFlag('media')]: false }, // a different domain
      }),
    });

    const outcome = await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: revenueAgent(),
      capability: OUTREACH,
    });

    expect(outcome.status).toBe('completed');
    expect(spy.calls).toBe(1);
  });

  it('is a no-op when no gate is configured (behaviour unchanged)', async () => {
    const spy = new SpyAdapter();
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1_OUTREACH,
      adapters: [spy],
      // no featureGate
    });

    const outcome = await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: revenueAgent(),
      capability: OUTREACH,
    });

    expect(outcome.status).toBe('completed');
    expect(spy.calls).toBe(1);
  });

  it('honours a tenant-targeted kill-switch via the passed context', async () => {
    const spy = new SpyAdapter();
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1_OUTREACH,
      adapters: [spy],
      // Globally on, but switched off for one tenant — proves the orchestrator
      // forwards a targeting context (tenantId) to the gate.
      featureGate: new StaticFeatureGate({
        flags: { [agentEnabledFlag('revenue')]: true },
        overrides: { [`${agentEnabledFlag('revenue')}@tenant:acme`]: false },
      }),
    });

    const blocked = await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: revenueAgent(),
      capability: OUTREACH,
      tenantId: 'acme',
    });
    expect(blocked.status).toBe('denied');
    expect(blocked.decision.policyId).toBe('feature-gate.kill-switch');
    expect(spy.calls).toBe(0);

    const allowed = await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: revenueAgent(),
      capability: OUTREACH,
      tenantId: 'other',
    });
    expect(allowed.status).toBe('completed');
    expect(spy.calls).toBe(1);
  });
});
