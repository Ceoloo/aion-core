import { z } from 'zod';
import {
  RequestId,
  MissionId,
  WorkflowId,
  RunId,
  CommandId,
  ActorId,
  AgentId,
  ToolId,
  ApprovalId,
  OutcomeId,
  CorrelationId,
} from './identifiers.js';
import { ActorType } from './actor.js';
import { RiskLevel } from './risk.js';
import { PolicyDecisionKind } from './policy.js';

/**
 * Telemetry contract — the observability spine.
 *
 * Every meaningful lifecycle step emits a TelemetryRecord carrying the full ID
 * chain plus operational facts (aion-docs/architecture/observability.md,
 * engineering/observability-standards.md). Context and outcomes are referenced,
 * never copied. Risk, approval state, and cost are always present. Failures are
 * emitted like successes.
 *
 * Telemetry (how an action ran) is distinct from events (durable business
 * facts) but linked by shared IDs — chiefly `runId` and `outcomeReference`.
 */

/** Gate status of an action at the moment the record is emitted. */
export const APPROVAL_STATES = [
  'not_required',
  'pending',
  'approved',
  'rejected',
] as const;
export const ApprovalState = z.enum(APPROVAL_STATES);
export type ApprovalState = z.infer<typeof ApprovalState>;

/** Outcome of the operation the record describes. */
export const OPERATION_STATUSES = [
  'ok',
  'denied',
  'pending',
  'failed',
] as const;
export const OperationStatus = z.enum(OPERATION_STATUSES);
export type OperationStatus = z.infer<typeof OperationStatus>;

export const TelemetryRecord = z.object({
  timestamp: z.string().datetime(),
  /** The lifecycle step, e.g. "policy.evaluate", "execution". */
  operation: z.string().min(1),
  status: OperationStatus,

  // ── ID chain (propagated end-to-end) ─────────────────────────────────────
  requestId: RequestId.optional(),
  missionId: MissionId.optional(),
  workflowId: WorkflowId.optional(),
  runId: RunId.optional(),
  commandId: CommandId.optional(),
  actorId: ActorId.optional(),
  agentId: AgentId.optional(),
  toolId: ToolId.optional(),
  approvalId: ApprovalId.optional(),
  correlationId: CorrelationId.optional(),

  // ── Operational facts ────────────────────────────────────────────────────
  actorType: ActorType.optional(),
  /** The tool invoked, if any. */
  toolUsed: ToolId.optional(),
  /** The model used, if a model was involved. Vendor-neutral, honest. */
  model: z.string().optional(),
  /** Reference to assembled input context (a pointer, not a dump). */
  inputContextReference: z.string().optional(),
  /** What was decided at this step, if it was a decision. */
  decision: PolicyDecisionKind.optional(),
  /** Duration of the step in milliseconds. */
  durationMs: z.number().nonnegative().optional(),
  /** Which execution environment ran the work, if applicable. */
  executor: z.string().optional(),
  /** Token usage, if a model was involved. */
  tokenUsage: z.number().nonnegative().optional(),
  /** Abstract cost units. */
  cost: z.number().nonnegative().optional(),
  /** Always present for a governed action. */
  riskLevel: RiskLevel.optional(),
  /** Always present: gate status. */
  approvalState: ApprovalState.optional(),
  /** Reference to the recorded outcome, if one exists. */
  outcomeReference: OutcomeId.optional(),

  metadata: z.record(z.unknown()).default({}),
});
export type TelemetryRecord = z.infer<typeof TelemetryRecord>;
