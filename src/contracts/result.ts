import { z } from 'zod';

/**
 * Result contract.
 *
 * Execution adapters return a normalized ExecutionResult regardless of which
 * runtime produced it (aion-docs/architecture/execution-layer.md). Core never
 * sees model-specific fields directly — provider-specific data lives inside
 * `metadata`, keeping the control plane vendor-agnostic.
 *
 * A failed execution is a first-class, observable result — not an exception
 * that vanishes. `status: 'failed'` with a structured `error` is as real as a
 * success.
 */
export const EXECUTION_STATUSES = ['succeeded', 'failed'] as const;
export const ExecutionStatus = z.enum(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

/** Structured, machine-readable failure detail. */
export const ExecutionErrorInfo = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
  details: z.record(z.unknown()).optional(),
});
export type ExecutionErrorInfo = z.infer<typeof ExecutionErrorInfo>;

/** Cost/usage of a single execution, in abstract units (no vendor coupling). */
export const ExecutionCost = z.object({
  /** Abstract spend units; a later phase may map these to currency. */
  units: z.number().nonnegative().default(0),
  /** Optional token usage when a model was involved. */
  tokens: z.number().nonnegative().optional(),
});
export type ExecutionCost = z.infer<typeof ExecutionCost>;

export const ExecutionResult = z.object({
  status: ExecutionStatus,
  /** The result payload on success (capability-specific). */
  output: z.record(z.unknown()).optional(),
  /** Structured error on failure. */
  error: ExecutionErrorInfo.optional(),
  /** Which execution environment/adapter produced this result. */
  executor: z.string().min(1),
  /** Model identifier, if a model was involved. Optional and vendor-neutral. */
  model: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  /** Duration in milliseconds. */
  durationMs: z.number().nonnegative(),
  cost: ExecutionCost.default({ units: 0 }),
  /** Provider-specific data lives here, invisible to the control plane. */
  metadata: z.record(z.unknown()).default({}),
});
export type ExecutionResult = z.infer<typeof ExecutionResult>;
