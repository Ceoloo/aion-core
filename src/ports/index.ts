/**
 * Ports barrel.
 *
 * Ports are the seam between AION Core and external infrastructure. Core defines
 * the interfaces it needs; concrete, durable implementations are supplied
 * externally (future aion-data / aion-infra). This is how Core stays independent
 * of any concrete database, broker, or observability vendor.
 */
export type { MissionRepository } from './mission-repository.js';
export type { WorkflowRepository } from './workflow-repository.js';
export type { RunRepository } from './run-repository.js';
export type { EventSink } from './event-sink.js';
export type { ApprovalStore } from './approval-store.js';
export type { TelemetrySink } from './telemetry-sink.js';
