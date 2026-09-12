/**
 * AION Core — public API.
 *
 * The control-plane kernel: it decides what work is requested, who requested
 * it, what capability is required, whether it is permitted, at what risk,
 * whether a human must approve, which execution adapter performs it, how the
 * run is traced, and what events and telemetry are emitted.
 *
 * Core is deliberately vendor- and database-agnostic. It defines persistence
 * PORTS and ships in-memory adapters for Phase 1; durable implementations are
 * supplied externally (future aion-data / aion-infra).
 *
 * Consumers import from this entry point only — internal module paths are not
 * part of the contract.
 */

// ── Contracts (the owned, stable shapes) ────────────────────────────────────
export * from './contracts/index.js';
export * from './contracts/factories.js';

// ── Errors ──────────────────────────────────────────────────────────────────
export * from './errors/index.js';

// ── Ports (persistence/observability seams) ─────────────────────────────────
export type {
  MissionRepository,
  WorkflowRepository,
  RunRepository,
  EventSink,
  ApprovalStore,
  TelemetrySink,
} from './ports/index.js';

// ── Policy layer ────────────────────────────────────────────────────────────
export {
  PolicyEngine,
  type PolicyEngineConfig,
  type AuthorizeContext,
} from './policy/policy-engine.js';
export {
  PermissionEvaluator,
  type PermissionCheck,
} from './policy/permission-evaluator.js';
export {
  RiskEvaluator,
  type RiskEvaluatorConfig,
  type CapabilityRiskMap,
  type RiskClassification,
  type RiskClassificationInput,
} from './policy/risk-evaluator.js';

// ── Approvals (human gate) ──────────────────────────────────────────────────
export { ApprovalGate } from './approvals/approval-gate.js';
export { InMemoryApprovalStore } from './approvals/in-memory-approval-store.js';

// ── Execution ───────────────────────────────────────────────────────────────
export type {
  ExecutionAdapter,
  ExecutionRequest,
} from './execution/execution-adapter.js';
export { ExecutionRegistry } from './execution/execution-registry.js';
export {
  MockExecutionAdapter,
  type MockExecutionAdapterOptions,
  type MockBehavior,
} from './execution/mock-execution-adapter.js';

// ── Events ──────────────────────────────────────────────────────────────────
export { EventEmitter, type EmitOptions } from './events/event-emitter.js';
export { InMemoryEventSink } from './events/in-memory-event-sink.js';

// ── Observability ───────────────────────────────────────────────────────────
export { Telemetry, type TelemetryInput } from './observability/telemetry.js';
export { InMemoryTelemetrySink } from './observability/in-memory-telemetry-sink.js';
export {
  type TraceContext,
  withTrace,
} from './observability/trace-context.js';
export {
  type Clock,
  systemClock,
  ManualClock,
} from './observability/clock.js';

// ── In-memory persistence adapters ──────────────────────────────────────────
export { InMemoryRunRepository } from './adapters/in-memory-run-repository.js';
export { InMemoryMissionRepository } from './adapters/in-memory-mission-repository.js';
export { InMemoryWorkflowRepository } from './adapters/in-memory-workflow-repository.js';

// ── Orchestration kernel ────────────────────────────────────────────────────
export {
  Orchestrator,
  type OrchestratorDeps,
  type OrchestrationResult,
} from './orchestration/orchestrator.js';
export {
  MissionOrchestrator,
  type MissionOrchestratorDeps,
  type MissionRunInput,
  type MissionOrchestrationResult,
  type MissionStepResult,
  type MissionOrchestrationStatus,
} from './orchestration/mission-orchestrator.js';
export {
  resolveOpportunityCapability,
  existingOpportunityId,
} from './orchestration/opportunity-entity-routing.js';
export {
  type RunContext,
  createRunContext,
  restoreRunContext,
} from './orchestration/run-context.js';
export {
  canTransition,
  assertTransition,
  transitionRun,
  isRunComplete,
} from './orchestration/lifecycle.js';
export {
  createInMemoryControlPlane,
  type ControlPlane,
  type ControlPlaneConfig,
} from './orchestration/control-plane.js';
