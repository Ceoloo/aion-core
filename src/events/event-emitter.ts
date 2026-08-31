import type { EventSink } from '../ports/event-sink.js';
import type { AionEvent, EventType } from '../contracts/event.js';
import type { EventId } from '../contracts/identifiers.js';
import { newEventId } from '../contracts/identifiers.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';
import type { TraceContext } from '../observability/trace-context.js';

/** What a caller supplies to emit a fact; identity/lineage are stamped here. */
export interface EmitOptions {
  type: EventType;
  trace: TraceContext;
  payload?: Record<string, unknown>;
  /** The event that caused this one, for the causal chain. */
  causationId?: EventId;
  metadata?: Record<string, unknown>;
}

/**
 * EventEmitter.
 *
 * Builds well-formed event envelopes from a {@link TraceContext} and writes them
 * to an {@link EventSink}. It mints the event id and timestamp centrally and
 * stamps the trace spine so every emitted fact is locatable within the intent
 * that produced it. Emission returns the created event so callers can chain
 * `causationId` for the next fact.
 */
export class EventEmitter {
  constructor(
    private readonly sink: EventSink,
    private readonly clock: Clock = systemClock,
  ) {}

  async emit(options: EmitOptions): Promise<AionEvent> {
    const { trace } = options;
    const event: AionEvent = {
      eventId: newEventId(),
      eventType: options.type,
      timestamp: this.clock.isoNow(),
      requestId: trace.requestId,
      correlationId: trace.correlationId,
      actorId: trace.actorId,
      ...(trace.missionId ? { missionId: trace.missionId } : {}),
      ...(trace.workflowId ? { workflowId: trace.workflowId } : {}),
      ...(trace.runId ? { runId: trace.runId } : {}),
      ...(options.causationId ? { causationId: options.causationId } : {}),
      payload: options.payload ?? {},
      metadata: options.metadata ?? {},
    };
    await this.sink.emit(event);
    return event;
  }
}
