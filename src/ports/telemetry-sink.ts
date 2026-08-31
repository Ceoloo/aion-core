import type { TelemetryRecord } from '../contracts/telemetry.js';

/**
 * TelemetrySink port.
 *
 * The destination for the observability spine. Core emits TelemetryRecords to
 * this contract; the tracing/metrics backend is infrastructure owned by
 * aion-infra and chosen via ADR (aion-docs/engineering/observability-standards.md).
 * Phase 1 uses an in-memory sink — no vendor (Datadog/OTEL/Grafana) is
 * integrated.
 */
export interface TelemetrySink {
  record(record: TelemetryRecord): Promise<void>;
}
