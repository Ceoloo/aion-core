import type { EventSink } from '../ports/event-sink.js';
import type { AionEvent, EventType } from '../contracts/event.js';

/**
 * In-memory {@link EventSink}.
 *
 * Appends events to an in-process log (append-only — never edited or deleted,
 * matching event-standards.md). Phase 1 default; a durable broker is deferred
 * to a future ADR. Exposes read helpers for tests and inspection.
 */
export class InMemoryEventSink implements EventSink {
  private readonly events: AionEvent[] = [];

  async emit(event: AionEvent): Promise<void> {
    this.events.push(event);
  }

  /** All emitted events, in emission order. */
  all(): readonly AionEvent[] {
    return [...this.events];
  }

  /** Events of a given type, in emission order. */
  ofType(type: EventType): AionEvent[] {
    return this.events.filter((e) => e.eventType === type);
  }

  /** The ordered sequence of event-type names, handy for assertions. */
  typeSequence(): EventType[] {
    return this.events.map((e) => e.eventType);
  }
}
