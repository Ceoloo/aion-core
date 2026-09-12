import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * Strongly-typed identifiers.
 *
 * AION Core does not pass arbitrary untyped strings around. Every identity in
 * the lifecycle is a branded string, so a `RunId` cannot be silently used where
 * a `MissionId` is expected. IDs are generated with a stable, human-readable
 * prefix (`run_...`, `cmd_...`) which keeps traces grep-able while remaining
 * globally unique (UUID v4 body).
 *
 * Traceability requirement (see aion-docs/architecture/observability.md): a
 * request entering AION must be followable from command creation through to the
 * execution result via this ID chain.
 */

/** The kinds of identifier the control plane mints and propagates. */
export const ID_KIND = {
  RequestId: 'req',
  MissionId: 'msn',
  WorkflowId: 'wf',
  RunId: 'run',
  CommandId: 'cmd',
  ActorId: 'act',
  AgentId: 'agt',
  ToolId: 'tool',
  ApprovalId: 'apr',
  EventId: 'evt',
  OutcomeId: 'out',
  CorrelationId: 'cor',
  ExecutionId: 'exe',
  ServiceId: 'svc',
  EvaluationId: 'evr',
  HandoffId: 'hof',
} as const;

export type IdKind = keyof typeof ID_KIND;

function idSchema<K extends IdKind>(kind: K) {
  return z
    .string()
    .min(1)
    .brand(kind);
}

export const RequestId = idSchema('RequestId');
export type RequestId = z.infer<typeof RequestId>;

export const MissionId = idSchema('MissionId');
export type MissionId = z.infer<typeof MissionId>;

export const WorkflowId = idSchema('WorkflowId');
export type WorkflowId = z.infer<typeof WorkflowId>;

export const RunId = idSchema('RunId');
export type RunId = z.infer<typeof RunId>;

export const CommandId = idSchema('CommandId');
export type CommandId = z.infer<typeof CommandId>;

export const ActorId = idSchema('ActorId');
export type ActorId = z.infer<typeof ActorId>;

export const AgentId = idSchema('AgentId');
export type AgentId = z.infer<typeof AgentId>;

export const ToolId = idSchema('ToolId');
export type ToolId = z.infer<typeof ToolId>;

export const ApprovalId = idSchema('ApprovalId');
export type ApprovalId = z.infer<typeof ApprovalId>;

export const EventId = idSchema('EventId');
export type EventId = z.infer<typeof EventId>;

export const OutcomeId = idSchema('OutcomeId');
export type OutcomeId = z.infer<typeof OutcomeId>;

export const CorrelationId = idSchema('CorrelationId');
export type CorrelationId = z.infer<typeof CorrelationId>;

export const ExecutionId = idSchema('ExecutionId');
export type ExecutionId = z.infer<typeof ExecutionId>;

export const ServiceId = idSchema('ServiceId');
export type ServiceId = z.infer<typeof ServiceId>;

export const EvaluationId = idSchema('EvaluationId');
export type EvaluationId = z.infer<typeof EvaluationId>;

export const HandoffId = idSchema('HandoffId');
export type HandoffId = z.infer<typeof HandoffId>;

/**
 * Maps an ID kind to its branded runtime type. Used by {@link generateId} so a
 * single generator can mint any kind while preserving the brand.
 */
export interface IdTypeMap {
  RequestId: RequestId;
  MissionId: MissionId;
  WorkflowId: WorkflowId;
  RunId: RunId;
  CommandId: CommandId;
  ActorId: ActorId;
  AgentId: AgentId;
  ToolId: ToolId;
  ApprovalId: ApprovalId;
  EventId: EventId;
  OutcomeId: OutcomeId;
  CorrelationId: CorrelationId;
  ExecutionId: ExecutionId;
  ServiceId: ServiceId;
  EvaluationId: EvaluationId;
  HandoffId: HandoffId;
}

/**
 * Pluggable ID source. Defaults to UUID v4, but tests (or a future distributed
 * deployment) can inject a deterministic or coordinated generator without
 * touching call sites.
 */
export interface IdGenerator {
  generate<K extends IdKind>(kind: K): IdTypeMap[K];
}

/** Mints a prefixed, branded identifier of the requested kind. */
export function generateId<K extends IdKind>(kind: K): IdTypeMap[K] {
  return `${ID_KIND[kind]}_${randomUUID()}` as IdTypeMap[K];
}

/** The default UUID-backed generator. */
export const defaultIdGenerator: IdGenerator = {
  generate: generateId,
};

export const newRequestId = (): RequestId => generateId('RequestId');
export const newMissionId = (): MissionId => generateId('MissionId');
export const newWorkflowId = (): WorkflowId => generateId('WorkflowId');
export const newRunId = (): RunId => generateId('RunId');
export const newCommandId = (): CommandId => generateId('CommandId');
export const newActorId = (): ActorId => generateId('ActorId');
export const newAgentId = (): AgentId => generateId('AgentId');
export const newToolId = (): ToolId => generateId('ToolId');
export const newApprovalId = (): ApprovalId => generateId('ApprovalId');
export const newEventId = (): EventId => generateId('EventId');
export const newOutcomeId = (): OutcomeId => generateId('OutcomeId');
export const newCorrelationId = (): CorrelationId => generateId('CorrelationId');
export const newExecutionId = (): ExecutionId => generateId('ExecutionId');
export const newServiceId = (): ServiceId => generateId('ServiceId');
export const newEvaluationId = (): EvaluationId => generateId('EvaluationId');
export const newHandoffId = (): HandoffId => generateId('HandoffId');
