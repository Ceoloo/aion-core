import { z } from 'zod';
import {
  RunId,
  RequestId,
  MissionId,
  WorkflowId,
  CommandId,
  ActorId,
  ApprovalId,
  CorrelationId,
} from './identifiers.js';
import { RiskLevel } from './risk.js';

/**
 * Run contract + lifecycle states.
 *
 * A Run is one execution of requested work. Its state machine is explicit and
 * illegal transitions are rejected (aion-docs invariant: "State transitions are
 * explicit"). The states below map directly onto the orchestration lifecycle:
 *
 *   created ─▶ evaluating ─┬─▶ denied              (policy DENY)
 *                          ├─▶ awaiting_approval ─┬─▶ approved ─▶ executing ...
 *                          │                      └─▶ denied     (gate rejected)
 *                          └─▶ executing ─┬─▶ completed          (success)
 *                                         └─▶ failed             (failure)
 *   (any non-terminal) ───▶ cancelled
 *
 * `awaiting_approval` is the pause point for a human gate; `approved` records
 * that the same run may now proceed — approval resumes the original run.
 */
export const RUN_STATES = [
  'created',
  'evaluating',
  'awaiting_approval',
  'approved',
  'executing',
  'completed',
  'failed',
  'denied',
  'cancelled',
] as const;
export const RunState = z.enum(RUN_STATES);
export type RunState = z.infer<typeof RunState>;

/** Terminal states — a run in one of these cannot transition further. */
export const TERMINAL_RUN_STATES: readonly RunState[] = [
  'completed',
  'failed',
  'denied',
  'cancelled',
];

export function isTerminalRunState(state: RunState): boolean {
  return TERMINAL_RUN_STATES.includes(state);
}

export const Run = z.object({
  runId: RunId,
  requestId: RequestId,
  missionId: MissionId.optional(),
  workflowId: WorkflowId.optional(),
  commandId: CommandId,
  /** The actor whose work this run performs. */
  actorId: ActorId,
  state: RunState,
  /** Centrally classified risk for this run (set once policy evaluates). */
  riskLevel: RiskLevel.optional(),
  /** The open/closed gate for this run, if one was required. */
  approvalId: ApprovalId.optional(),
  /** Groups the run's events and telemetry into one logical operation. */
  correlationId: CorrelationId,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Run = z.infer<typeof Run>;
