import { describe, it, expect } from 'vitest';
import {
  createInMemoryControlPlane,
  createAgentActor,
  ManualClock,
  capability,
  HarnessExecutionAdapter,
  InMemoryHarnessProvider,
  type CommandInput,
} from '../../src/index.js';

const OUTREACH = capability('revenue.outreach');

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

/** Route a command at a harness via metadata.harnessId. */
function command(harnessId: string | undefined, extra: Record<string, unknown> = {}): CommandInput {
  return {
    name: 'SendOutreach',
    actor: revenueAgent(),
    capability: OUTREACH,
    payload: { goal: 'draft an outreach email' },
    metadata: harnessId ? { harnessId, ...extra } : extra,
  };
}

const R1 = { risk: { capabilityRisk: { 'revenue.outreach': 'R1' as const } } };

describe('HarnessExecutionAdapter (ADR-011)', () => {
  it('dispatches an authorized command to the selected harness', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }, { id: 'claude-code', kind: 'claude-code' }],
    });
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1,
      adapters: [new HarnessExecutionAdapter(provider, { name: 'harness' })],
    });

    const outcome = await plane.orchestrator.submit(command('codex', { model: 'gpt-5.4-mini' }));

    expect(outcome.status).toBe('completed');
    expect(outcome.decision.decision).toBe('ALLOW'); // policy authorized FIRST
    expect(outcome.result?.status).toBe('succeeded');
    expect(outcome.result?.executor).toBe('harness:codex');
    expect(outcome.result?.model).toBe('gpt-5.4-mini');
    expect(outcome.result?.output).toEqual({ echoed: 'draft an outreach email' });
    expect(outcome.result?.metadata).toMatchObject({ harnessId: 'codex' });

    // The provider was consulted only after authorization, once, with the risk.
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.harnessId).toBe('codex');
    expect(provider.calls[0]?.riskLevel).toBe('R1');
    expect(provider.calls[0]?.input).toBe('draft an outreach email');
  });

  it('clamps the dispatched budget to the authorized actor ceiling', async () => {
    const provider = new InMemoryHarnessProvider({ harnesses: [{ id: 'codex', kind: 'codex' }] });
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1,
      adapters: [new HarnessExecutionAdapter(provider)],
    });
    const budgetedAgent = createAgentActor({
      name: 'Budgeted',
      purpose: 'x',
      owner: 'o',
      domain: 'revenue',
      permissions: [OUTREACH],
      maxRiskLevel: 'R3',
      costBudget: 5,
    });

    // Caller asks for 1000; the actor's ceiling is 5 → dispatched budget is 5.
    await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: budgetedAgent,
      capability: OUTREACH,
      payload: { goal: 'g' },
      metadata: { harnessId: 'codex', budgetUnits: 1000 },
    });
    expect(provider.calls[0]?.budgetUnits).toBe(5);

    // Caller omits a budget → defaults to the ceiling, not unbounded.
    await plane.orchestrator.submit({
      name: 'SendOutreach',
      actor: budgetedAgent,
      capability: OUTREACH,
      payload: { goal: 'g' },
      metadata: { harnessId: 'codex' },
    });
    expect(provider.calls[1]?.budgetUnits).toBe(5);
  });

  it('fails closed when the provider errors (visible failed result)', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
      failFor: ['codex'],
    });
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1,
      adapters: [new HarnessExecutionAdapter(provider)],
    });

    const outcome = await plane.orchestrator.submit(command('codex'));

    expect(outcome.status).toBe('failed'); // not a silent success
    expect(outcome.result?.status).toBe('failed');
    expect(outcome.result?.error?.code).toBe('HARNESS_ERROR');
    expect(outcome.run.state).toBe('failed');
  });

  it('treats an indeterminate outcome as failed-but-flagged with the idempotency key', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
      indeterminateFor: ['codex'],
    });
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1,
      adapters: [new HarnessExecutionAdapter(provider)],
    });

    const outcome = await plane.orchestrator.submit(command('codex'));

    expect(outcome.result?.status).toBe('failed'); // never a silent success
    expect(outcome.result?.error?.code).toBe('HARNESS_TRANSPORT_LOST');
    expect(outcome.result?.error?.retryable).toBe(true);
    // Flagged so the ledger reconciles/cancels rather than blindly retrying.
    expect(outcome.result?.metadata).toMatchObject({ indeterminate: true });
    expect(outcome.result?.metadata.idempotencyKey).toBe(outcome.run.requestId);
    // The dispatch carried a stable idempotency key across the seam.
    expect(provider.calls[0]?.idempotencyKey).toBe(outcome.run.requestId);
  });

  it('normalizes an unknown harness to a failed result', async () => {
    const provider = new InMemoryHarnessProvider({ harnesses: [{ id: 'codex', kind: 'codex' }] });
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: R1,
      adapters: [new HarnessExecutionAdapter(provider)],
    });

    const outcome = await plane.orchestrator.submit(command('does-not-exist'));

    expect(outcome.result?.status).toBe('failed');
    expect(outcome.result?.error?.code).toBe('HARNESS_NOT_FOUND');
    expect(outcome.result?.executor).toBe('harness:does-not-exist');
  });

  it('does not handle a command with no resolvable harness (adapter opts out)', async () => {
    const provider = new InMemoryHarnessProvider();
    const adapter = new HarnessExecutionAdapter(provider);
    const plane = createInMemoryControlPlane({ clock: new ManualClock(), policy: R1, adapters: [adapter] });

    // No harnessId and no toolId → canHandle is false → no adapter resolves it.
    const outcome = await plane.orchestrator.submit(command(undefined));

    expect(outcome.status).toBe('failed');
    expect(outcome.result?.error?.code).toBe('EXECUTOR_NOT_FOUND');
    expect(provider.calls).toHaveLength(0);
  });
});

describe('InMemoryHarnessProvider', () => {
  it('lists harnesses, supports known ids, and records cancellations', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'a', kind: 'custom' }, { id: 'b', kind: 'custom' }],
    });
    expect(provider.listHarnesses().map((h) => h.id)).toEqual(['a', 'b']);
    expect(provider.supports('a')).toBe(true);
    expect(provider.supports('z')).toBe(false);

    await provider.cancel({ sessionId: 'sess_1' });
    expect(provider.cancellations).toEqual([{ sessionId: 'sess_1' }]);
  });
});
