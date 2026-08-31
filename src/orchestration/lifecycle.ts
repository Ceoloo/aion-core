import type { Run, RunState } from '../contracts/run.js';
import { isTerminalRunState } from '../contracts/run.js';
import { InvalidStateTransitionError } from '../errors/index.js';
import type { Clock } from '../observability/clock.js';

/**
 * Run lifecycle state machine.
 *
 * The legal transitions are explicit and enforced; any other move throws
 * {@link InvalidStateTransitionError} (aion-docs invariant: "State transitions
 * are explicit. Illegal transitions should be rejected").
 *
 *   created ─▶ evaluating ─┬─▶ denied
 *                          ├─▶ awaiting_approval ─┬─▶ approved ─▶ executing
 *                          │                      └─▶ denied
 *                          └─▶ executing ─┬─▶ completed
 *                                         └─▶ failed
 *   created | evaluating | awaiting_approval ─▶ cancelled
 */
const LEGAL_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  // `evaluating`/`approved` → `failed` covers a routing failure (no adapter)
  // that occurs after the action is cleared but before execution starts.
  created: ['evaluating', 'cancelled'],
  evaluating: ['denied', 'awaiting_approval', 'executing', 'failed', 'cancelled'],
  awaiting_approval: ['approved', 'denied', 'cancelled'],
  approved: ['executing', 'failed', 'cancelled'],
  executing: ['completed', 'failed'],
  completed: [],
  failed: [],
  denied: [],
  cancelled: [],
};

/** True if `from → to` is a legal run transition. */
export function canTransition(from: RunState, to: RunState): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/** Throws {@link InvalidStateTransitionError} if `from → to` is illegal. */
export function assertTransition(from: RunState, to: RunState): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(
      `illegal run transition ${from} → ${to}`,
      { from, to },
    );
  }
}

/**
 * Returns a new Run in state `to`, validating the transition and bumping
 * `updatedAt`. Pure with respect to the input run (returns a copy).
 */
export function transitionRun(run: Run, to: RunState, clock: Clock): Run {
  assertTransition(run.state, to);
  return { ...run, state: to, updatedAt: clock.isoNow() };
}

/** True if the run is in a terminal state. */
export function isRunComplete(run: Run): boolean {
  return isTerminalRunState(run.state);
}
