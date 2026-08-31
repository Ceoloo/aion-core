import type {
  RequestId,
  MissionId,
  WorkflowId,
  RunId,
  CommandId,
  ActorId,
  AgentId,
  ToolId,
  CorrelationId,
} from '../contracts/identifiers.js';
import type { ActorType } from '../contracts/actor.js';

/**
 * TraceContext — the propagated ID chain for one unit of work.
 *
 * Created when the orchestrator receives a command and threaded through every
 * lifecycle step, so events and telemetry all share the same lineage
 * (aion-docs/engineering/observability-standards.md: "Propagate the ID chain …
 * A new unit of work derives its IDs from its parent"). This is the single
 * source of the identifiers stamped onto emitted facts and records.
 */
export interface TraceContext {
  requestId: RequestId;
  correlationId: CorrelationId;
  commandId: CommandId;
  actorId: ActorId;
  actorType: ActorType;
  missionId?: MissionId;
  workflowId?: WorkflowId;
  runId?: RunId;
  agentId?: AgentId;
  toolId?: ToolId;
}

/** Returns a copy of `ctx` with additional/overridden fields (immutably). */
export function withTrace(
  ctx: TraceContext,
  patch: Partial<TraceContext>,
): TraceContext {
  return { ...ctx, ...patch };
}
