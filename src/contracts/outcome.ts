import { z } from 'zod';
import { OutcomeId, RunId, MissionId } from './identifiers.js';

/**
 * Outcome reference contract.
 *
 * A *result* is what an execution produced ("Proposal successfully sent"). An
 * *outcome* is the real-world consequence ("Customer accepted and paid $5,000").
 * They are different concepts and Phase 1 preserves the distinction without
 * building the learning system (aion-docs/engineering/principles.md #6).
 *
 * Core only defines enough of an OutcomeReference for a future aion-data system
 * to associate real outcomes with runs. Core does not store or evaluate
 * outcomes itself.
 */
export const OUTCOME_STATUSES = [
  'pending',
  'realized',
  'failed',
  'unknown',
] as const;
export const OutcomeStatus = z.enum(OUTCOME_STATUSES);
export type OutcomeStatus = z.infer<typeof OutcomeStatus>;

export const OutcomeReference = z.object({
  /** Assigned when a durable outcome record is created (later phases). */
  outcomeId: OutcomeId.optional(),
  /** The run whose result may lead to this outcome. */
  runId: RunId,
  missionId: MissionId.optional(),
  status: OutcomeStatus.default('pending'),
  /** Pointer to the real-world record (e.g. an invoice id) — not the data. */
  externalReference: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type OutcomeReference = z.infer<typeof OutcomeReference>;
