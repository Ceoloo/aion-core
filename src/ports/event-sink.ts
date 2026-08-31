import type { AionEvent } from '../contracts/event.js';

/**
 * EventSink port.
 *
 * The destination for emitted domain events (facts). Core depends on this
 * contract, not on a broker or database — the event bus is deferred technology
 * chosen later via ADR (aion-docs/engineering/event-standards.md). Phase 1 uses
 * an in-memory sink.
 *
 * Events are append-only facts; a sink never edits or deletes.
 */
export interface EventSink {
  emit(event: AionEvent): Promise<void>;
}
