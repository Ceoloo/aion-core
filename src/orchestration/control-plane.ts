import { PolicyEngine, type PolicyEngineConfig } from '../policy/policy-engine.js';
import { ExecutionRegistry } from '../execution/execution-registry.js';
import type { ExecutionAdapter } from '../execution/execution-adapter.js';
import { ApprovalGate } from '../approvals/approval-gate.js';
import { EventEmitter } from '../events/event-emitter.js';
import { Telemetry } from '../observability/telemetry.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';

import { InMemoryRunRepository } from '../adapters/in-memory-run-repository.js';
import { InMemoryMissionRepository } from '../adapters/in-memory-mission-repository.js';
import { InMemoryWorkflowRepository } from '../adapters/in-memory-workflow-repository.js';
import { InMemoryEventSink } from '../events/in-memory-event-sink.js';
import { InMemoryApprovalStore } from '../approvals/in-memory-approval-store.js';
import { InMemoryTelemetrySink } from '../observability/in-memory-telemetry-sink.js';

import { Orchestrator } from './orchestrator.js';
import { MissionOrchestrator } from './mission-orchestrator.js';

export interface ControlPlaneConfig {
  policy?: PolicyEngineConfig;
  /** Execution adapters to register, in resolution-priority order. */
  adapters?: ExecutionAdapter[];
  clock?: Clock;
}

/**
 * A fully-wired, in-memory control plane. Handles to the sinks/stores are
 * exposed so callers (examples, tests) can inspect emitted events, telemetry,
 * runs, and approvals.
 */
export interface ControlPlane {
  orchestrator: Orchestrator;
  missionOrchestrator: MissionOrchestrator;
  policyEngine: PolicyEngine;
  registry: ExecutionRegistry;
  approvalGate: ApprovalGate;
  runRepository: InMemoryRunRepository;
  missionRepository: InMemoryMissionRepository;
  workflowRepository: InMemoryWorkflowRepository;
  eventSink: InMemoryEventSink;
  telemetrySink: InMemoryTelemetrySink;
  approvalStore: InMemoryApprovalStore;
  clock: Clock;
}

/**
 * Assembles the Phase 1 control plane with in-memory adapters. This is the
 * one-call way to stand up a testable kernel with no network, database, or
 * provider SDK — the whole point of the persistence-port boundary.
 */
export function createInMemoryControlPlane(
  config: ControlPlaneConfig = {},
): ControlPlane {
  const clock = config.clock ?? systemClock;

  const eventSink = new InMemoryEventSink();
  const telemetrySink = new InMemoryTelemetrySink();
  const runRepository = new InMemoryRunRepository();
  const missionRepository = new InMemoryMissionRepository();
  const workflowRepository = new InMemoryWorkflowRepository();
  const approvalStore = new InMemoryApprovalStore();

  const events = new EventEmitter(eventSink, clock);
  const telemetry = new Telemetry(telemetrySink, clock);
  const policyEngine = new PolicyEngine(config.policy ?? {}, { clock });
  const approvalGate = new ApprovalGate(approvalStore, clock);

  const registry = new ExecutionRegistry();
  for (const adapter of config.adapters ?? []) {
    registry.register(adapter);
  }

  const orchestrator = new Orchestrator({
    policyEngine,
    registry,
    approvalGate,
    runRepository,
    events,
    telemetry,
    clock,
  });

  const missionOrchestrator = new MissionOrchestrator({
    orchestrator,
    missions: missionRepository,
    workflows: workflowRepository,
    clock,
  });

  return {
    orchestrator,
    missionOrchestrator,
    policyEngine,
    registry,
    approvalGate,
    runRepository,
    missionRepository,
    workflowRepository,
    eventSink,
    telemetrySink,
    approvalStore,
    clock,
  };
}
