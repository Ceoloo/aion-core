import { z } from 'zod';
import {
  AgentId,
  CorrelationId,
  EventId,
  ExecutionId,
  OutcomeId,
  WorkflowId,
} from './identifiers.js';

/**
 * Canonical control-plane entities (AIO-10), schema version 1.
 *
 * Additive layer: these do not replace existing shapes such as `Workflow`,
 * `AionEvent`, `OutcomeReference`, `PolicyDecision` or `AgentRegistryRecord`.
 * They are the versioned, tenant-scoped envelope that domain repos (Data,
 * Runtime, Products) map to. Every entity carries:
 *
 * - `kind`: discriminator naming the entity,
 * - `schemaVersion`: a literal; parsers reject unknown versions,
 * - `tenantId`: required. Every canonical entity is tenant-scoped,
 * - `createdAt` / `updatedAt`: UTC ISO-8601,
 * - optional trace spine (`correlationId`, `executionId`) and `provenance`.
 *
 * No runtime behaviour depends on this module yet.
 */

export const CANONICAL_SCHEMA_VERSION = '1' as const;

/** New ID kinds introduced for canonical entities (prefix → kind). */
export const CANONICAL_ID_KIND = {
  TenantId: 'tnt',
  WorkforceId: 'wfc',
  TaskId: 'tsk',
  PolicyId: 'pol',
  MemoryId: 'mem',
  LearningSignalId: 'lsg',
  CustomerId: 'cus',
  OpportunityId: 'opp',
  EconomicValueId: 'ecv',
} as const;
export type CanonicalIdKind = keyof typeof CANONICAL_ID_KIND;

function canonicalId<K extends CanonicalIdKind>(kind: K) {
  const prefix = `${CANONICAL_ID_KIND[kind]}_`;
  return z
    .string()
    .min(prefix.length + 1)
    .refine((v) => v.startsWith(prefix), { message: `${kind} must start with "${prefix}"` })
    .brand(kind);
}

export const TenantId = canonicalId('TenantId');
export type TenantId = z.infer<typeof TenantId>;
export const WorkforceId = canonicalId('WorkforceId');
export type WorkforceId = z.infer<typeof WorkforceId>;
export const TaskId = canonicalId('TaskId');
export type TaskId = z.infer<typeof TaskId>;
export const PolicyId = canonicalId('PolicyId');
export type PolicyId = z.infer<typeof PolicyId>;
export const MemoryId = canonicalId('MemoryId');
export type MemoryId = z.infer<typeof MemoryId>;
export const LearningSignalId = canonicalId('LearningSignalId');
export type LearningSignalId = z.infer<typeof LearningSignalId>;
export const CustomerId = canonicalId('CustomerId');
export type CustomerId = z.infer<typeof CustomerId>;
export const OpportunityId = canonicalId('OpportunityId');
export type OpportunityId = z.infer<typeof OpportunityId>;
export const EconomicValueId = canonicalId('EconomicValueId');
export type EconomicValueId = z.infer<typeof EconomicValueId>;

export const CanonicalProvenance = z.object({
  source: z.string().min(1),
  sourceRef: z.string().min(1).optional(),
  recordedBy: z.string().min(1).optional(),
});
export type CanonicalProvenance = z.infer<typeof CanonicalProvenance>;

const base = {
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  tenantId: TenantId,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  correlationId: CorrelationId.optional(),
  executionId: ExecutionId.optional(),
  provenance: CanonicalProvenance.optional(),
  metadata: z.record(z.unknown()).default({}),
};

export const CanonicalAgent = z.object({
  ...base,
  kind: z.literal('Agent'),
  id: AgentId,
  name: z.string().min(1),
  ownerId: z.string().min(1),
  workforceId: WorkforceId.optional(),
});
export const CanonicalWorkforce = z.object({
  ...base,
  kind: z.literal('Workforce'),
  id: WorkforceId,
  name: z.string().min(1),
  agentIds: z.array(AgentId).default([]),
});
export const CanonicalTask = z.object({
  ...base,
  kind: z.literal('Task'),
  id: TaskId,
  title: z.string().min(1),
  status: z.string().min(1),
  assigneeAgentId: AgentId.optional(),
  workflowId: WorkflowId.optional(),
});
export const CanonicalWorkflow = z.object({
  ...base,
  kind: z.literal('Workflow'),
  id: WorkflowId,
  name: z.string().min(1),
  definitionVersion: z.string().min(1),
});
export const CanonicalEvent = z.object({
  ...base,
  kind: z.literal('Event'),
  id: EventId,
  eventType: z.string().min(1),
  occurredAt: z.string().datetime(),
  causationId: EventId.optional(),
  payload: z.record(z.unknown()).default({}),
});
export const CanonicalPolicy = z.object({
  ...base,
  kind: z.literal('Policy'),
  id: PolicyId,
  name: z.string().min(1),
  policyVersion: z.string().min(1),
});
export const CanonicalMemory = z.object({
  ...base,
  kind: z.literal('Memory'),
  id: MemoryId,
  subjectRef: z.string().min(1),
  content: z.string().min(1),
});
export const CanonicalLearningSignal = z.object({
  ...base,
  kind: z.literal('LearningSignal'),
  id: LearningSignalId,
  signal: z.string().min(1),
  outcomeId: OutcomeId.optional(),
});
export const CanonicalOutcome = z.object({
  ...base,
  kind: z.literal('Outcome'),
  id: OutcomeId,
  status: z.string().min(1),
  externalReference: z.string().min(1).optional(),
});
export const CanonicalCustomer = z.object({
  ...base,
  kind: z.literal('Customer'),
  id: CustomerId,
  name: z.string().min(1),
});
export const CanonicalOpportunity = z.object({
  ...base,
  kind: z.literal('Opportunity'),
  id: OpportunityId,
  customerId: CustomerId,
  stage: z.string().min(1),
});
export const CanonicalEconomicValue = z.object({
  ...base,
  kind: z.literal('EconomicValue'),
  id: EconomicValueId,
  /** Minor units (e.g. cents) to avoid float drift. */
  amountMinor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  opportunityId: OpportunityId.optional(),
  outcomeId: OutcomeId.optional(),
});

export type CanonicalAgent = z.infer<typeof CanonicalAgent>;
export type CanonicalWorkforce = z.infer<typeof CanonicalWorkforce>;
export type CanonicalTask = z.infer<typeof CanonicalTask>;
export type CanonicalWorkflow = z.infer<typeof CanonicalWorkflow>;
export type CanonicalEvent = z.infer<typeof CanonicalEvent>;
export type CanonicalPolicy = z.infer<typeof CanonicalPolicy>;
export type CanonicalMemory = z.infer<typeof CanonicalMemory>;
export type CanonicalLearningSignal = z.infer<typeof CanonicalLearningSignal>;
export type CanonicalOutcome = z.infer<typeof CanonicalOutcome>;
export type CanonicalCustomer = z.infer<typeof CanonicalCustomer>;
export type CanonicalOpportunity = z.infer<typeof CanonicalOpportunity>;
export type CanonicalEconomicValue = z.infer<typeof CanonicalEconomicValue>;

export const CANONICAL_ENTITY_SCHEMAS = {
  Agent: CanonicalAgent,
  Workforce: CanonicalWorkforce,
  Task: CanonicalTask,
  Workflow: CanonicalWorkflow,
  Event: CanonicalEvent,
  Policy: CanonicalPolicy,
  Memory: CanonicalMemory,
  LearningSignal: CanonicalLearningSignal,
  Outcome: CanonicalOutcome,
  Customer: CanonicalCustomer,
  Opportunity: CanonicalOpportunity,
  EconomicValue: CanonicalEconomicValue,
} as const;
export type CanonicalEntityKind = keyof typeof CANONICAL_ENTITY_SCHEMAS;
export const CANONICAL_ENTITY_KINDS = Object.keys(CANONICAL_ENTITY_SCHEMAS) as CanonicalEntityKind[];

export const CanonicalEntity = z.discriminatedUnion('kind', [
  CanonicalAgent, CanonicalWorkforce, CanonicalTask, CanonicalWorkflow,
  CanonicalEvent, CanonicalPolicy, CanonicalMemory, CanonicalLearningSignal,
  CanonicalOutcome, CanonicalCustomer, CanonicalOpportunity, CanonicalEconomicValue,
]);
export type CanonicalEntity = z.infer<typeof CanonicalEntity>;

export class UnknownSchemaVersionError extends Error {
  constructor(readonly kind: string, readonly schemaVersion: unknown) {
    super(`unsupported schemaVersion ${JSON.stringify(schemaVersion)} for ${kind}; supported: "${CANONICAL_SCHEMA_VERSION}"`);
    this.name = 'UnknownSchemaVersionError';
  }
}

/** Parse any canonical entity; throws UnknownSchemaVersionError before shape validation. */
export function parseCanonicalEntity(input: unknown): CanonicalEntity {
  const v = (input as { schemaVersion?: unknown; kind?: unknown } | null) ?? {};
  if (v.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
    throw new UnknownSchemaVersionError(String(v.kind ?? 'unknown'), v.schemaVersion);
  }
  return CanonicalEntity.parse(input);
}
