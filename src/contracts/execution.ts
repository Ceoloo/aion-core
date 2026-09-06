import { z } from 'zod';
import {
  ExecutionId,
  RunId,
  RequestId,
  MissionId,
  WorkflowId,
  CommandId,
  ActorId,
  ApprovalId,
  CorrelationId,
  OutcomeId,
  newExecutionId,
} from './identifiers.js';
import { RiskLevel } from './risk.js';
import { AutonomyLevel } from './autonomy.js';
import { AgentUri } from './agent-identity.js';
import { ExecutionCost } from './result.js';
import type { ExecutionResult } from './result.js';
import type { Run } from './run.js';
import type { AgentActor } from './actor.js';

/**
 * Canonical Execution Object (`aion_execution`).
 *
 * The atomic unit of AION machine labor (Execution Platform Progress Assessment,
 * Sep 2026). Converges run lifecycle, gateway records, product sessions, and
 * adapter results into one enterprise object covering:
 *
 *   - identity scope (who / which agent / tenant / domain)
 *   - autonomy + approval
 *   - refs (run, command, mission, workflow, correlation)
 *   - status
 *   - cost breakdown
 *   - outcome / ROI fields
 *   - audit_trace
 *
 * Core owns the contract. aion-data persists it. aion-runtime's HTTP surface
 * (the reconciled Execution Gateway — not a second gateway service) creates and
 * serves it. Products must not invent a parallel execution record.
 */

/** Lifecycle status for the Execution Object (superset of run + result). */
export const EXECUTION_OBJECT_STATUSES = [
  'created',
  'evaluating',
  'awaiting_approval',
  'approved',
  'executing',
  'succeeded',
  'failed',
  'denied',
  'cancelled',
] as const;
export const ExecutionObjectStatus = z.enum(EXECUTION_OBJECT_STATUSES);
export type ExecutionObjectStatus = z.infer<typeof ExecutionObjectStatus>;

/** One append-only audit entry on an Execution Object. */
export const ExecutionAuditEntry = z.object({
  at: z.string().datetime(),
  event: z.string().min(1),
  detail: z.record(z.unknown()).default({}),
});
export type ExecutionAuditEntry = z.infer<typeof ExecutionAuditEntry>;

/**
 * Cost breakdown for an execution. Extends the adapter-level {@link ExecutionCost}
 * with provider/model economics and optional dollar / ROI attribution. All
 * currency fields are optional until the pricing ledger lands; units remain the
 * vendor-neutral abstract spend.
 */
export const ExecutionCostBreakdown = ExecutionCost.extend({
  provider: z.string().optional(),
  model: z.string().optional(),
  inputTokens: z.number().nonnegative().optional(),
  outputTokens: z.number().nonnegative().optional(),
  cachedTokens: z.number().nonnegative().optional(),
  toolCost: z.number().nonnegative().optional(),
  computeCost: z.number().nonnegative().optional(),
  estimatedDollars: z.number().nonnegative().optional(),
  actualDollars: z.number().nonnegative().optional(),
});
export type ExecutionCostBreakdown = z.infer<typeof ExecutionCostBreakdown>;

export const ExecutionObject = z.object({
  /** Stable id for this execution record (`exe_…`). */
  executionId: ExecutionId,

  // ── Identity scope ───────────────────────────────────────────────────────
  actorId: ActorId,
  /** Canonical agent URI when the actor is an agent. */
  agentUri: AgentUri.optional(),
  tenantId: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  /** Optional company within the tenant (Mission 003 scope). */
  companyId: z.string().min(1).optional(),
  /** Optional venture within the company. */
  ventureId: z.string().min(1).optional(),
  /** Optional project within the venture. */
  projectId: z.string().min(1).optional(),
  /** Immediate parent execution (worker spawned by an orchestrator). */
  parentExecutionId: ExecutionId.optional(),
  /** Root of the execution tree (defaults to self at create). */
  rootExecutionId: ExecutionId.optional(),

  // ── Refs ─────────────────────────────────────────────────────────────────
  runId: RunId,
  requestId: RequestId,
  commandId: CommandId,
  missionId: MissionId.optional(),
  workflowId: WorkflowId.optional(),
  correlationId: CorrelationId,

  // ── Status / autonomy / approval ─────────────────────────────────────────
  status: ExecutionObjectStatus,
  autonomyLevel: AutonomyLevel.default('L1'),
  riskLevel: RiskLevel.optional(),
  approvalId: ApprovalId.optional(),

  // ── Cost / outcome / ROI ─────────────────────────────────────────────────
  cost: ExecutionCostBreakdown.default({ units: 0 }),
  outcomeId: OutcomeId.optional(),
  outcomeSummary: z.string().optional(),
  revenueAttributed: z.number().optional(),

  // ── Audit ────────────────────────────────────────────────────────────────
  auditTrace: z.array(ExecutionAuditEntry).default([]),

  // ── Timestamps ───────────────────────────────────────────────────────────
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),

  metadata: z.record(z.unknown()).default({}),
});
export type ExecutionObject = z.infer<typeof ExecutionObject>;

/** Alias used in docs and Progress Assessment language. */
export type AionExecution = ExecutionObject;

/**
 * Map a Core {@link Run} state (+ optional terminal result) onto an
 * Execution Object status.
 */
export function executionStatusFromRun(
  runState: Run['state'],
  result?: ExecutionResult,
): ExecutionObjectStatus {
  if (runState === 'completed') {
    return result?.status === 'failed' ? 'failed' : 'succeeded';
  }
  if (runState === 'failed') return 'failed';
  if (runState === 'denied') return 'denied';
  if (runState === 'cancelled') return 'cancelled';
  if (runState === 'awaiting_approval') return 'awaiting_approval';
  if (runState === 'approved') return 'approved';
  if (runState === 'executing') return 'executing';
  if (runState === 'evaluating') return 'evaluating';
  return 'created';
}

export interface CreateExecutionObjectInput {
  run: Run;
  agent?: AgentActor;
  result?: ExecutionResult;
  executionId?: ExecutionId;
  tenantId?: string;
  companyId?: string;
  ventureId?: string;
  projectId?: string;
  parentExecutionId?: ExecutionId;
  rootExecutionId?: ExecutionId;
  autonomyLevel?: AutonomyLevel;
  auditTrace?: ExecutionAuditEntry[];
  outcomeId?: OutcomeId;
  outcomeSummary?: string;
  revenueAttributed?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Build a canonical Execution Object from a governed Run (and optional agent /
 * adapter result). Used by Runtime when accepting work through the Execution
 * Gateway HTTP surface.
 */
export function createExecutionObject(
  input: CreateExecutionObjectInput,
): ExecutionObject {
  const { run, agent, result } = input;
  const now = run.updatedAt;
  const cost: ExecutionCostBreakdown = result
    ? {
        units: result.cost.units,
        tokens: result.cost.tokens,
        provider:
          typeof result.metadata['provider'] === 'string'
            ? result.metadata['provider']
            : undefined,
        model: result.model,
      }
    : { units: 0 };

  const executionId = input.executionId ?? newExecutionId();
  return ExecutionObject.parse({
    executionId,
    actorId: run.actorId,
    agentUri: agent?.agentUri,
    tenantId: input.tenantId ?? agent?.tenantId,
    domain: agent?.domain,
    companyId: input.companyId ?? agent?.companyId,
    ventureId: input.ventureId ?? agent?.ventureId,
    projectId: input.projectId ?? agent?.projectId,
    parentExecutionId: input.parentExecutionId,
    rootExecutionId:
      input.rootExecutionId ?? input.parentExecutionId ?? executionId,
    runId: run.runId,
    requestId: run.requestId,
    commandId: run.commandId,
    missionId: run.missionId,
    workflowId: run.workflowId,
    correlationId: run.correlationId,
    status: executionStatusFromRun(run.state, result),
    autonomyLevel: input.autonomyLevel ?? agent?.autonomyLevel ?? 'L1',
    riskLevel: run.riskLevel,
    approvalId: run.approvalId,
    cost,
    outcomeId: input.outcomeId,
    outcomeSummary: input.outcomeSummary,
    revenueAttributed: input.revenueAttributed,
    auditTrace: input.auditTrace ?? [
      {
        at: run.createdAt,
        event: 'execution.created',
        detail: { runId: run.runId, state: run.state },
      },
    ],
    createdAt: run.createdAt,
    updatedAt: now,
    startedAt: result?.startedAt,
    completedAt: result?.completedAt,
    metadata: input.metadata ?? {},
  });
}
