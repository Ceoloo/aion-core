import { z } from 'zod';
import {
  EventId,
  RequestId,
  MissionId,
  WorkflowId,
  RunId,
  ActorId,
  CorrelationId,
} from './identifiers.js';

/**
 * Event contract.
 *
 * Events are completed facts, stated in the past tense
 * (aion-docs/engineering/event-standards.md). A command or intention must never
 * be disguised as an event. The control plane emits these facts as the
 * lifecycle progresses; the learning loop (later phases) reconstructs outcomes
 * from them, so honesty here is non-negotiable.
 *
 * Naming follows `entity.pastTenseVerb`. Every event name below is a fact that
 * has already happened — `policy.denied`, `execution.completed` — never an
 * instruction.
 */
export const EVENT_TYPES = [
  'command.received',
  'command.rejected',
  'policy.allowed',
  'policy.denied',
  'approval.requested',
  'approval.granted',
  'approval.rejected',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'run.cancelled',
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

/**
 * Base event envelope.
 *
 * Carries the lineage/trace spine so any fact can be located within the intent
 * that caused it. Not every ID is mandatory — a fact emitted before a run
 * exists (e.g. an early validation rejection) may lack a `runId` — but the
 * chain is preserved wherever it exists.
 *
 *  - `correlationId` groups all events of one logical operation.
 *  - `causationId` points at the event that directly caused this one, giving an
 *    explicit causal chain through the lifecycle.
 */
export const AionEvent = z.object({
  eventId: EventId,
  eventType: EventType,
  /** When the fact occurred (UTC ISO-8601). */
  timestamp: z.string().datetime(),

  // ── Trace spine ──────────────────────────────────────────────────────────
  requestId: RequestId.optional(),
  missionId: MissionId.optional(),
  workflowId: WorkflowId.optional(),
  runId: RunId.optional(),
  actorId: ActorId.optional(),
  /** Groups every event belonging to the same logical operation. */
  correlationId: CorrelationId.optional(),
  /** The event that caused this one, if any. */
  causationId: EventId.optional(),

  /** The facts of what happened (never intentions). */
  payload: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
});
export type AionEvent = z.infer<typeof AionEvent>;

/** Fields an emitter supplies; identity + timestamp are minted centrally. */
export type EventDraft = Omit<AionEvent, 'eventId' | 'timestamp'> & {
  eventId?: EventId;
  timestamp?: string;
};
