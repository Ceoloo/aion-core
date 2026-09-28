import { z } from 'zod';
import { AgentHandoff } from './agent-handoff.js';
import { Actor } from './actor.js';
import { Capability } from './capability.js';
import {
  ApprovalId,
  MissionId,
  RequestId,
  RunId,
  WorkItemId,
} from './identifiers.js';
import { RiskLevel } from './risk.js';

/**
 * A work item is the ticket one harness hands another.
 *
 * The only message on it is an {@link AgentHandoff}. Chat transcripts are not
 * a field. Harnesses do not call each other; they wake this ticket, and the
 * control plane dispatches whoever holds the checkout.
 */
export const WORK_ITEM_STATUSES = [
  'queued',
  'checked_out',
  'completed',
  'failed',
  'cancelled',
  'indeterminate',
] as const;
export const WorkItemStatus = z.enum(WORK_ITEM_STATUSES);
export type WorkItemStatus = z.infer<typeof WorkItemStatus>;

export const WorkItemError = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
});
export type WorkItemError = z.infer<typeof WorkItemError>;

export const WorkItem = z.object({
  workItemId: WorkItemId,
  status: WorkItemStatus,
  /** Harness that should run this ticket. Selection is routing, not permission. */
  harnessId: z.string().min(1),
  /** The only cross-harness message. */
  handoff: AgentHandoff,
  actor: Actor,
  capability: Capability,
  commandName: z.string().min(1),
  missionId: MissionId.optional(),
  stepName: z.string().min(1).optional(),
  /** Harness session to resume. Absent until the first run mints one. */
  sessionId: z.string().min(1).optional(),
  /** Ceiling forwarded to the harness. The actor cost budget still clamps it. */
  budgetUnits: z.number().nonnegative().finite().optional(),
  model: z.string().min(1).optional(),
  riskLevel: RiskLevel.optional(),
  /** Set while `checked_out` or `indeterminate`. The holding harness id. */
  holder: z.string().min(1).optional(),
  /**
   * Idempotency key for the dispatch. A retry after an indeterminate outcome
   * reuses it so the harness de-duplicates instead of re-running side effects.
   */
  requestId: RequestId.optional(),
  runId: RunId.optional(),
  approvalId: ApprovalId.optional(),
  lastError: WorkItemError.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WorkItem = z.infer<typeof WorkItem>;
