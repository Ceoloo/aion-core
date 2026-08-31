import type { TelemetrySink } from '../ports/telemetry-sink.js';
import type { TelemetryRecord } from '../contracts/telemetry.js';
import type { RunId } from '../contracts/identifiers.js';

/**
 * In-memory {@link TelemetrySink}.
 *
 * Collects the observability spine in-process. Phase 1 default; no external
 * observability vendor is integrated. Read helpers support trace-continuity
 * assertions in tests.
 */
export class InMemoryTelemetrySink implements TelemetrySink {
  private readonly records: TelemetryRecord[] = [];

  async record(record: TelemetryRecord): Promise<void> {
    this.records.push(record);
  }

  /** All records, in emission order. */
  all(): readonly TelemetryRecord[] {
    return [...this.records];
  }

  /** Records belonging to a single run. */
  forRun(runId: RunId): TelemetryRecord[] {
    return this.records.filter((r) => r.runId === runId);
  }
}
