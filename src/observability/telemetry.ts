import type { TelemetrySink } from '../ports/telemetry-sink.js';
import type {
  TelemetryRecord,
  ApprovalState,
  OperationStatus,
} from '../contracts/telemetry.js';
import type { PolicyDecisionKind } from '../contracts/policy.js';
import type { RiskLevel } from '../contracts/risk.js';
import type { ToolId, OutcomeId, ApprovalId } from '../contracts/identifiers.js';
import type { Clock } from './clock.js';
import { systemClock } from './clock.js';
import type { TraceContext } from './trace-context.js';

/** Operational facts a caller adds to a telemetry record for one step. */
export interface TelemetryInput {
  operation: string;
  status: OperationStatus;
  trace: TraceContext;
  riskLevel?: RiskLevel;
  approvalState?: ApprovalState;
  decision?: PolicyDecisionKind;
  durationMs?: number;
  executor?: string;
  model?: string;
  toolUsed?: ToolId;
  approvalId?: ApprovalId;
  inputContextReference?: string;
  tokenUsage?: number;
  cost?: number;
  outcomeReference?: OutcomeId;
  metadata?: Record<string, unknown>;
}

/**
 * Telemetry emitter.
 *
 * Builds a {@link TelemetryRecord} for a lifecycle step from the propagated
 * {@link TraceContext} plus operational facts, and writes it to a
 * {@link TelemetrySink}. The trace spine is always stamped; risk, approval
 * state, and cost are populated wherever they apply. Failures are recorded the
 * same way as successes.
 */
export class Telemetry {
  constructor(
    private readonly sink: TelemetrySink,
    private readonly clock: Clock = systemClock,
  ) {}

  async record(input: TelemetryInput): Promise<TelemetryRecord> {
    const { trace } = input;
    const record: TelemetryRecord = {
      timestamp: this.clock.isoNow(),
      operation: input.operation,
      status: input.status,
      requestId: trace.requestId,
      correlationId: trace.correlationId,
      commandId: trace.commandId,
      actorId: trace.actorId,
      actorType: trace.actorType,
      ...(trace.missionId ? { missionId: trace.missionId } : {}),
      ...(trace.workflowId ? { workflowId: trace.workflowId } : {}),
      ...(trace.runId ? { runId: trace.runId } : {}),
      ...(trace.agentId ? { agentId: trace.agentId } : {}),
      ...(trace.toolId ? { toolId: trace.toolId } : {}),
      ...(input.approvalId ? { approvalId: input.approvalId } : {}),
      ...(input.toolUsed ? { toolUsed: input.toolUsed } : {}),
      ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
      ...(input.approvalState ? { approvalState: input.approvalState } : {}),
      ...(input.decision ? { decision: input.decision } : {}),
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.executor ? { executor: input.executor } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.inputContextReference
        ? { inputContextReference: input.inputContextReference }
        : {}),
      ...(input.tokenUsage !== undefined ? { tokenUsage: input.tokenUsage } : {}),
      ...(input.cost !== undefined ? { cost: input.cost } : {}),
      ...(input.outcomeReference
        ? { outcomeReference: input.outcomeReference }
        : {}),
      metadata: input.metadata ?? {},
    };
    await this.sink.record(record);
    return record;
  }
}
