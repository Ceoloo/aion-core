import { describe, it, expect } from 'vitest';
import {
  createInMemoryControlPlane,
  createAgentActor,
  createHumanActor,
  MockExecutionAdapter,
  ManualClock,
  capability,
  type ExecutionAdapter,
  type ExecutionRequest,
  type ExecutionResult,
  type CommandInput,
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

const RESEARCH = capability('research.summary');
const DEPLOY = capability('deployment.execute');

function researchAgentActor() {
  return createAgentActor({
    name: 'ResearchAgent',
    purpose: 'summarize',
    owner: 'growth',
    permissions: [RESEARCH],
    defaultRiskLevel: 'R1',
    maxRiskLevel: 'R3',
  });
}

describe('Scenario A — allowed execution (ALLOW → success)', () => {
  it('runs a low-risk command to completion with a connected trace', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: { risk: { capabilityRisk: { 'research.summary': 'R1' } } },
      adapters: [
        new MockExecutionAdapter({
          name: 'research-runtime',
          capabilities: [RESEARCH],
          output: { summary: 'ok' },
          cost: { units: 2 },
        }),
      ],
    });

    const human = createHumanActor({
      name: 'Analyst',
      permissions: [RESEARCH],
      maxRiskLevel: 'R2',
    });
    const input: CommandInput = {
      name: 'ResearchProspect',
      actor: human,
      capability: RESEARCH,
    };

    const outcome = await plane.orchestrator.submit(input);

    expect(outcome.status).toBe('completed');
    expect(outcome.decision.decision).toBe('ALLOW');
    expect(outcome.run.state).toBe('completed');
    expect(outcome.result?.status).toBe('succeeded');
    expect(outcome.result?.executor).toBe('research-runtime');
    expect(outcome.outcomeReference?.runId).toBe(outcome.run.runId);

    // events emitted, in order
    expect(plane.eventSink.typeSequence()).toEqual([
      'command.received',
      'policy.allowed',
      'execution.started',
      'execution.completed',
    ]);

    // telemetry captured
    expect(plane.telemetrySink.forRun(outcome.run.runId).length).toBeGreaterThan(0);
  });
});

describe('Scenario B — human approval required (REQUIRE_APPROVAL → resume same run)', () => {
  it('pauses at a gate and resumes the SAME run on approval', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: { risk: { capabilityRisk: { 'deployment.execute': 'R3' } } },
      adapters: [
        new MockExecutionAdapter({
          name: 'deploy-runtime',
          capabilities: [DEPLOY],
          output: { deployed: true },
        }),
      ],
    });

    const agent = createAgentActor({
      name: 'Deployer',
      purpose: 'deploy',
      owner: 'platform',
      permissions: [DEPLOY],
      maxRiskLevel: 'R3',
    });

    const pending = await plane.orchestrator.submit({
      name: 'DeployApplication',
      actor: agent,
      capability: DEPLOY,
    });

    expect(pending.status).toBe('awaiting_approval');
    expect(pending.decision.decision).toBe('REQUIRE_APPROVAL');
    expect(pending.run.state).toBe('awaiting_approval');
    expect(pending.approval?.status).toBe('pending');
    expect(await plane.approvalStore.list('pending')).toHaveLength(1);

    const pausedRunId = pending.run.runId;

    // A different human approves.
    const approver = createHumanActor({ name: 'Boss', maxRiskLevel: 'R3' });
    const resumed = await plane.orchestrator.resume({
      approvalId: pending.approval!.approvalId,
      approve: true,
      decidedBy: approver.actorId,
    });

    expect(resumed.status).toBe('completed');
    expect(resumed.run.runId).toBe(pausedRunId); // SAME run resumed
    expect(resumed.run.state).toBe('completed');
    expect(resumed.result?.executor).toBe('deploy-runtime');

    // full event sequence across the pause
    expect(plane.eventSink.typeSequence()).toEqual([
      'command.received',
      'approval.requested',
      'approval.granted',
      'execution.started',
      'execution.completed',
    ]);

    // exactly one execution happened
    expect(plane.eventSink.ofType('execution.started')).toHaveLength(1);
  });

  it('denies the run when the gate is rejected (no execution)', async () => {
    const spy = new SpyAdapter();
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: { risk: { capabilityRisk: { 'deployment.execute': 'R3' } } },
      adapters: [spy],
    });
    const agent = createAgentActor({
      name: 'Deployer',
      purpose: 'deploy',
      owner: 'platform',
      permissions: [DEPLOY],
      maxRiskLevel: 'R3',
    });

    const pending = await plane.orchestrator.submit({
      name: 'DeployApplication',
      actor: agent,
      capability: DEPLOY,
    });
    const rejected = await plane.orchestrator.resume({
      approvalId: pending.approval!.approvalId,
      approve: false,
      decidedBy: createHumanActor({ name: 'Boss', maxRiskLevel: 'R3' }).actorId,
    });

    expect(rejected.status).toBe('denied');
    expect(rejected.run.state).toBe('denied');
    expect(spy.calls).toBe(0); // rejected → never executed
    expect(plane.eventSink.typeSequence()).toContain('approval.rejected');
  });
});

describe('Scenario C — denied execution (DENY, adapter never called)', () => {
  it('denies a forbidden capability before any execution', async () => {
    const spy = new SpyAdapter();
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      adapters: [spy],
    });

    // Agent is not granted the capability it requests.
    const agent = createAgentActor({
      name: 'Rogue',
      purpose: 'x',
      owner: 'o',
      permissions: [RESEARCH],
    });

    const outcome = await plane.orchestrator.submit({
      name: 'DeployApplication',
      actor: agent,
      capability: DEPLOY,
    });

    expect(outcome.status).toBe('denied');
    expect(outcome.decision.decision).toBe('DENY');
    expect(outcome.run.state).toBe('denied');
    expect(spy.calls).toBe(0); // never reached execution
    expect(outcome.result).toBeUndefined();

    expect(plane.eventSink.typeSequence()).toEqual([
      'command.received',
      'policy.denied',
    ]);
    const denialTelemetry = plane.telemetrySink
      .forRun(outcome.run.runId)
      .find((t) => t.status === 'denied');
    expect(denialTelemetry?.decision).toBe('DENY');
  });
});

describe('Scenario D — execution failure (normalized failed result)', () => {
  it('normalizes a returned failure into a failed run', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: { risk: { capabilityRisk: { 'research.summary': 'R1' } } },
      adapters: [
        new MockExecutionAdapter({
          name: 'flaky-runtime',
          capabilities: [RESEARCH],
          behavior: 'fail',
          error: { code: 'UPSTREAM', message: 'boom', retryable: true },
        }),
      ],
    });

    const outcome = await plane.orchestrator.submit({
      name: 'ResearchProspect',
      actor: researchAgentActor(),
      capability: RESEARCH,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.run.state).toBe('failed');
    expect(outcome.result?.status).toBe('failed');
    expect(outcome.result?.error?.code).toBe('UPSTREAM');
    expect(plane.eventSink.typeSequence()).toContain('execution.failed');
  });

  it('normalizes a THROWN adapter error into a failed run', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: { risk: { capabilityRisk: { 'research.summary': 'R1' } } },
      adapters: [
        new MockExecutionAdapter({
          name: 'throwing-runtime',
          capabilities: [RESEARCH],
          behavior: 'throw',
        }),
      ],
    });

    const outcome = await plane.orchestrator.submit({
      name: 'ResearchProspect',
      actor: researchAgentActor(),
      capability: RESEARCH,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.result?.error?.code).toBe('EXECUTION');
    expect(plane.eventSink.ofType('execution.failed')).toHaveLength(1);
  });

  it('fails safe when no adapter can handle the (allowed) capability', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: { risk: { capabilityRisk: { 'research.summary': 'R1' } } },
      adapters: [], // nothing registered
    });

    const outcome = await plane.orchestrator.submit({
      name: 'ResearchProspect',
      actor: researchAgentActor(),
      capability: RESEARCH,
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.result?.error?.code).toBe('EXECUTOR_NOT_FOUND');
    expect(outcome.run.state).toBe('failed');
  });
});

describe('Trace continuity', () => {
  it('keeps request/correlation/run ids connected across events and telemetry', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: { risk: { capabilityRisk: { 'research.summary': 'R1' } } },
      adapters: [
        new MockExecutionAdapter({ name: 'r', capabilities: [RESEARCH] }),
      ],
    });

    const outcome = await plane.orchestrator.submit({
      name: 'ResearchProspect',
      actor: researchAgentActor(),
      capability: RESEARCH,
    });

    const { runId, requestId, correlationId } = outcome.run;

    // Every emitted event shares the trace spine.
    for (const evt of plane.eventSink.all()) {
      expect(evt.requestId).toBe(requestId);
      expect(evt.correlationId).toBe(correlationId);
      expect(evt.runId).toBe(runId);
    }

    // Every telemetry record shares the trace spine.
    for (const rec of plane.telemetrySink.all()) {
      expect(rec.requestId).toBe(requestId);
      expect(rec.correlationId).toBe(correlationId);
      expect(rec.runId).toBe(runId);
    }

    // A causal chain exists: later events point back via causationId.
    const withCausation = plane.eventSink
      .all()
      .filter((e) => e.causationId !== undefined);
    expect(withCausation.length).toBeGreaterThan(0);
  });
});
