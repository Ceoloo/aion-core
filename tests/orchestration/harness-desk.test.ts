import { describe, it, expect } from 'vitest';
import {
  HarnessDesk,
  InMemoryHarnessProvider,
  HarnessExecutionAdapter,
  ManualClock,
  ValidationError,
  NotFoundError,
  InvalidStateTransitionError,
  capability,
  createAgentActor,
  createAgentHandoff,
  createInMemoryControlPlane,
  newWorkItemId,
  type AgentHandoff,
  type HarnessExecutionProvider,
  type HarnessRunRequest,
  type HarnessRunResult,
} from '../../src/index.js';

const OUTREACH = capability('revenue.outreach');
const R1 = { risk: { capabilityRisk: { 'revenue.outreach': 'R1' as const } } };

function agent(permissions: Array<typeof OUTREACH> = [OUTREACH]) {
  return createAgentActor({
    name: 'Outreacher',
    purpose: 'send outreach',
    owner: 'growth',
    domain: 'revenue',
    role: 'outreach',
    permissions,
    defaultRiskLevel: 'R1',
    maxRiskLevel: 'R3',
    costBudget: 5,
  });
}

function handoff(need = 'draft the next outreach step'): AgentHandoff {
  return createAgentHandoff({
    kind: 'delegation',
    need,
    confidence: 0.9,
    facts: [{ statement: 'PASTED_TRANSCRIPT should not cross the harness seam' }],
    artifactRefs: [
      {
        id: 'art_spec',
        kind: 'file',
        ref: 'aion-core/src/contracts/agent-handoff.ts',
      },
    ],
  });
}

function deskWith(provider: HarnessExecutionProvider) {
  const plane = createInMemoryControlPlane({
    clock: new ManualClock(),
    policy: R1,
    adapters: [new HarnessExecutionAdapter(provider)],
  });
  const desk = new HarnessDesk({ orchestrator: plane.orchestrator, clock: plane.clock });
  return { plane, desk };
}

describe('HarnessDesk', () => {
  it('keeps the AgentHandoff as the message and does not paste facts into the harness', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
    });
    const { desk } = deskWith(provider);
    const message = handoff();

    const opened = desk.open({
      handoff: message,
      harnessId: 'codex',
      actor: agent(),
      capability: OUTREACH,
      stepName: 'draft',
    });

    expect(opened.status).toBe('queued');
    expect(opened.handoff.handoffId).toBe(message.handoffId);
    expect(opened.handoff.facts[0]?.statement).toContain('PASTED_TRANSCRIPT');

    const pulse = await desk.pulse();
    const done = pulse.dispatched[0];
    expect(done?.status).toBe('completed');
    expect(done?.holder).toBeUndefined();
    expect(done?.handoff.need).toBe(message.need);

    const call = provider.calls[0];
    expect(call?.input).toBe(message.need);
    expect(call?.contextReference).toBe(`handoff:${message.handoffId}`);
    expect(call?.fileRefs).toEqual(['aion-core/src/contracts/agent-handoff.ts']);
    expect(JSON.stringify(call)).not.toContain('PASTED_TRANSCRIPT');
    expect(provider.calls).toHaveLength(1);
  });

  it('rejects a message that is not an AgentHandoff', () => {
    const { desk } = deskWith(new InMemoryHarnessProvider());
    expect(() =>
      desk.open({
        handoff: { transcript: 'here is the whole chat' } as unknown as AgentHandoff,
        harnessId: 'codex',
        actor: agent(),
        capability: OUTREACH,
      }),
    ).toThrow(ValidationError);
  });

  it('coalesces duplicate wakes into one harness run', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
    });
    const { desk } = deskWith(provider);
    const opened = desk.open({
      handoff: handoff(),
      harnessId: 'codex',
      actor: agent(),
      capability: OUTREACH,
    });

    expect(desk.wake(opened.workItemId).coalesced).toBe(true);
    expect(desk.wake(opened.workItemId).coalesced).toBe(true);

    const pulse = await desk.pulse();
    expect(pulse.dispatched).toHaveLength(1);
    expect(pulse.held).toEqual([]);
    expect(provider.calls).toHaveLength(1);
  });

  it('does not run a ticket a second time while a harness holds the checkout', async () => {
    const inner = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const provider: HarnessExecutionProvider = {
      listHarnesses: () => inner.listHarnesses(),
      supports: (id) => inner.supports(id),
      cancel: (ref) => inner.cancel(ref),
      async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
        entered();
        await gate;
        return inner.run(request);
      },
    };
    const { desk } = deskWith(provider);
    const opened = desk.open({
      handoff: handoff(),
      harnessId: 'codex',
      actor: agent(),
      capability: OUTREACH,
    });

    const first = desk.pulse();
    await enteredGate;
    expect(desk.wake(opened.workItemId).coalesced).toBe(false);
    const second = await desk.pulse();

    expect(second.held).toEqual([opened.workItemId]);
    expect(second.dispatched).toEqual([]);
    expect(inner.calls).toHaveLength(0);

    release();
    const finished = await first;
    expect(finished.dispatched[0]?.status).toBe('completed');
    expect(inner.calls).toHaveLength(1);
    expect(desk.get(opened.workItemId)?.holder).toBeUndefined();
  });

  it('does not call the harness when policy denies the command', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
    });
    const { desk } = deskWith(provider);
    const opened = desk.open({
      handoff: handoff(),
      harnessId: 'codex',
      actor: agent([]),
      capability: OUTREACH,
    });

    const pulse = await desk.pulse();
    expect(pulse.dispatched[0]?.status).toBe('failed');
    expect(pulse.dispatched[0]?.lastError?.code).toBe('POLICY_DENIED');
    expect(pulse.dispatched[0]?.holder).toBeUndefined();
    expect(provider.calls).toHaveLength(0);
    expect(desk.get(opened.workItemId)?.status).toBe('failed');
  });

  it('holds an indeterminate checkout until it is cancelled or retried under the same key', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
      indeterminateFor: ['codex'],
    });
    const { desk } = deskWith(provider);
    const opened = desk.open({
      handoff: handoff(),
      harnessId: 'codex',
      actor: agent(),
      capability: OUTREACH,
    });

    const first = await desk.pulse();
    expect(first.dispatched[0]?.status).toBe('indeterminate');
    expect(first.dispatched[0]?.holder).toBe('codex');
    const key = provider.calls[0]?.idempotencyKey;
    expect(key).toBeTruthy();

    expect(desk.get(opened.workItemId)?.holder).toBe('codex');
    expect(desk.wake(opened.workItemId).coalesced).toBe(false);

    const held = await desk.pulse();
    expect(held.held).toEqual([opened.workItemId]);
    expect(held.dispatched).toEqual([]);
    expect(provider.calls).toHaveLength(1);

    const retried = desk.reconcile(opened.workItemId, 'retry');
    expect(retried.status).toBe('queued');
    expect(retried.holder).toBeUndefined();
    expect(retried.requestId).toBe(key);

    const second = await desk.pulse();
    expect(second.dispatched[0]?.status).toBe('indeterminate');
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.idempotencyKey).toBe(key);

    const cancelled = desk.reconcile(opened.workItemId, 'cancel');
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.holder).toBeUndefined();
    expect(() => desk.wake(opened.workItemId)).toThrow(InvalidStateTransitionError);
  });

  it('resumes a session and stops before a run that would exceed the budget', async () => {
    const provider = new InMemoryHarnessProvider({
      harnesses: [{ id: 'codex', kind: 'codex' }],
      usageUnits: 1,
    });
    const { desk } = deskWith(provider);
    const actor = agent();

    const first = desk.open({
      handoff: handoff('first pass'),
      harnessId: 'codex',
      actor,
      capability: OUTREACH,
      budgetUnits: 1,
    });
    const started = await desk.pulse();
    const sessionId = started.dispatched[0]?.sessionId;
    expect(sessionId).toMatch(/^sess_mem_/);

    const second = desk.open({
      handoff: handoff('second pass'),
      harnessId: 'codex',
      actor,
      capability: OUTREACH,
      budgetUnits: 1,
      sessionId,
    });
    const stopped = await desk.pulse();
    expect(stopped.dispatched[0]?.status).toBe('failed');
    expect(stopped.dispatched[0]?.lastError?.code).toBe('BUDGET_EXCEEDED');
    expect(stopped.dispatched[0]?.workItemId).toBe(second.workItemId);
    expect(provider.calls[1]?.sessionId).toBe(sessionId);
    expect(desk.get(first.workItemId)?.status).toBe('completed');
  });

  it('waking an unknown ticket is an error', () => {
    const { desk } = deskWith(new InMemoryHarnessProvider());
    expect(() => desk.wake(newWorkItemId())).toThrow(NotFoundError);
  });
});
