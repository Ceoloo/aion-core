import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertTransition,
  transitionRun,
  isRunComplete,
  ManualClock,
  InvalidStateTransitionError,
  type Run,
  newRunId,
  newRequestId,
  newCommandId,
  newActorId,
  newCorrelationId,
} from '../../src/index.js';

const clock = new ManualClock();

function makeRun(state: Run['state']): Run {
  const now = clock.isoNow();
  return {
    runId: newRunId(),
    requestId: newRequestId(),
    commandId: newCommandId(),
    actorId: newActorId(),
    state,
    correlationId: newCorrelationId(),
    createdAt: now,
    updatedAt: now,
  };
}

describe('run lifecycle state machine', () => {
  it('permits declared legal transitions', () => {
    expect(canTransition('created', 'evaluating')).toBe(true);
    expect(canTransition('evaluating', 'awaiting_approval')).toBe(true);
    expect(canTransition('awaiting_approval', 'approved')).toBe(true);
    expect(canTransition('approved', 'executing')).toBe(true);
    expect(canTransition('executing', 'completed')).toBe(true);
    expect(canTransition('executing', 'failed')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('created', 'completed')).toBe(false);
    expect(canTransition('denied', 'executing')).toBe(false);
    expect(canTransition('completed', 'executing')).toBe(false);
    expect(() => assertTransition('created', 'executing')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('transitionRun returns a new run and bumps updatedAt', () => {
    const c = new ManualClock();
    const run = { ...makeRun('created'), updatedAt: c.isoNow() };
    c.advance(1000);
    const next = transitionRun(run, 'evaluating', c);
    expect(next.state).toBe('evaluating');
    expect(next.updatedAt).not.toBe(run.updatedAt);
    expect(run.state).toBe('created'); // original untouched
  });

  it('identifies terminal states', () => {
    expect(isRunComplete(makeRun('completed'))).toBe(true);
    expect(isRunComplete(makeRun('failed'))).toBe(true);
    expect(isRunComplete(makeRun('denied'))).toBe(true);
    expect(isRunComplete(makeRun('cancelled'))).toBe(true);
    expect(isRunComplete(makeRun('executing'))).toBe(false);
  });
});
