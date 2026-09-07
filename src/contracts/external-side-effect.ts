import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApprovalId, ExecutionId } from './identifiers.js';
import { ServiceKey } from './service.js';

/**
 * Mission 009 — External side-effect contract for live third-party mutations
 * (GoHighLevel and future CRM / SaaS adapters).
 *
 * HARD BOUNDARY:
 *   GoHighLevel owns CRM state.
 *   AION owns why the action happened, who authorized it, which capability
 *   executed it, what it cost, and what outcome followed.
 *
 * Every live external mutation MUST be recorded with this contract so retries
 * do not create duplicate opportunities, notes, messages, or updates.
 */

export const EXTERNAL_SIDE_EFFECT_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'replayed',
] as const;
export const ExternalSideEffectStatus = z.enum(EXTERNAL_SIDE_EFFECT_STATUSES);
export type ExternalSideEffectStatus = z.infer<typeof ExternalSideEffectStatus>;

/** Branded side-effect id (`ese_…`). */
export const ExternalSideEffectId = z.string().min(1).brand('ExternalSideEffectId');
export type ExternalSideEffectId = z.infer<typeof ExternalSideEffectId>;

export function newExternalSideEffectId(): ExternalSideEffectId {
  return `ese_${randomUUID()}` as ExternalSideEffectId;
}

export const ExternalSideEffect = z.object({
  sideEffectId: ExternalSideEffectId,
  /** AION execution that requested the mutation. */
  executionId: ExecutionId,
  tenantId: z.string().min(1),
  serviceKey: ServiceKey,
  /** Stable key — unique per intended external mutation. */
  idempotencyKey: z.string().min(1),
  /** Provider resource id after success (contact id, opportunity id, …). */
  externalResourceId: z.string().min(1).optional(),
  /** Provider request / correlation id when returned. */
  externalRequestId: z.string().min(1).optional(),
  requestedAction: z.string().min(1),
  approvalId: ApprovalId.optional(),
  performedAt: z.string().datetime(),
  /** SHA-256 hex of canonical success payload (detect silent drift). */
  resultHash: z.string().min(1).optional(),
  status: ExternalSideEffectStatus,
  provider: z.string().min(1).default('ghl'),
  errorCode: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ExternalSideEffect = z.infer<typeof ExternalSideEffect>;

export interface BuildIdempotencyKeyInput {
  executionId: string;
  tenantId: string;
  serviceKey: string;
  requestedAction: string;
  /** Optional stable fingerprint of the mutation target / body. */
  targetKey?: string;
}

/** Deterministic idempotency key for an intended external mutation. */
export function buildExternalIdempotencyKey(input: BuildIdempotencyKeyInput): string {
  const material = [
    input.tenantId,
    input.serviceKey,
    input.executionId,
    input.requestedAction,
    input.targetKey ?? '',
  ].join('|');
  return `ik_${createHash('sha256').update(material).digest('hex')}`;
}

/** Canonical SHA-256 hex of a JSON-serializable result payload. */
export function hashExternalResult(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export interface CreateExternalSideEffectInput {
  executionId: string;
  tenantId: string;
  serviceKey: string;
  idempotencyKey: string;
  requestedAction: string;
  performedAt: string;
  status: ExternalSideEffectStatus;
  provider?: string;
  sideEffectId?: string;
  externalResourceId?: string;
  externalRequestId?: string;
  approvalId?: string;
  resultHash?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export function createExternalSideEffect(
  input: CreateExternalSideEffectInput,
): ExternalSideEffect {
  return ExternalSideEffect.parse({
    sideEffectId: input.sideEffectId ?? newExternalSideEffectId(),
    executionId: input.executionId,
    tenantId: input.tenantId,
    serviceKey: input.serviceKey,
    idempotencyKey: input.idempotencyKey,
    requestedAction: input.requestedAction,
    performedAt: input.performedAt,
    status: input.status,
    provider: input.provider ?? 'ghl',
    ...(input.externalResourceId ? { externalResourceId: input.externalResourceId } : {}),
    ...(input.externalRequestId ? { externalRequestId: input.externalRequestId } : {}),
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
    ...(input.resultHash ? { resultHash: input.resultHash } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    metadata: input.metadata ?? {},
  });
}
