import { z } from 'zod';
import { ExecutionId } from './identifiers.js';
import { EXECUTION_OBJECT_STATUSES } from './execution.js';
import { OUTCOME_STATUSES } from './outcome.js';

/**
 * Agent Trust Score (ADR-006) — per-execution trust judgment.
 *
 * Hard dimensions (permissionCompliance, humanGateCompliance) force
 * status=untrusted when they fail. See aion-docs/governance/agent-trust-score.md.
 */

export const TRUST_DIMENSION_IDS = [
  'taskCompletion',
  'toolCorrectness',
  'permissionCompliance',
  'humanGateCompliance',
  'executionCost',
] as const;
export const TrustDimensionId = z.enum(TRUST_DIMENSION_IDS);
export type TrustDimensionId = z.infer<typeof TrustDimensionId>;

export const TRUST_SCORE_STATUSES = [
  'trusted',
  'degraded',
  'untrusted',
  'incomplete',
] as const;
export const TrustScoreStatus = z.enum(TRUST_SCORE_STATUSES);
export type TrustScoreStatus = z.infer<typeof TrustScoreStatus>;

export const TrustDimension = z.object({
  id: TrustDimensionId,
  passed: z.boolean(),
  /** 0..1 contribution / fitness; null when unknown */
  score: z.number().min(0).max(1).nullable(),
  evidence: z.array(z.string()).default([]),
});
export type TrustDimension = z.infer<typeof TrustDimension>;

export const AgentTrustScore = z.object({
  executionId: ExecutionId,
  computedAt: z.string().datetime(),
  status: TrustScoreStatus,
  /** 0..100 integer confidence for the client card */
  confidence: z.number().int().min(0).max(100),
  dimensions: z.array(TrustDimension).length(5),
  cost: z.object({
    units: z.number().nonnegative().nullable(),
    usd: z.number().nonnegative().nullable(),
    currency: z.literal('USD').nullable(),
  }),
});
export type AgentTrustScore = z.infer<typeof AgentTrustScore>;

const NON_TERMINAL = new Set([
  'created',
  'evaluating',
  'awaiting_approval',
  'approved',
  'executing',
]);

export type PolicyEventLike = {
  kind?: string;
  decision?: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
};

/** Evidence bag consumed by {@link computeAgentTrustScore}. */
export type AgentTrustScoreEvidence = {
  executionId: string;
  computedAt?: string;
  executionStatus: (typeof EXECUTION_OBJECT_STATUSES)[number] | string;
  evaluationSuccess?: boolean;
  evaluationPresent?: boolean;
  qualityScore?: number;
  outcomeStatus?: (typeof OUTCOME_STATUSES)[number];
  outcomeRequired?: boolean;
  toolsUsed?: readonly string[];
  allowedTools?: readonly string[];
  policyEvents?: readonly PolicyEventLike[];
  authorizeDecision?: 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';
  gateRequired?: boolean;
  approvalGranted?: boolean;
  approvalByHuman?: boolean;
  costUnits?: number;
  costUsd?: number;
  budgetCeiling?: number;
};

function dim(
  id: TrustDimensionId,
  passed: boolean,
  score: number | null,
  evidence: string[],
): TrustDimension {
  return TrustDimension.parse({ id, passed, score, evidence });
}

function hasDeny(
  events: readonly PolicyEventLike[] | undefined,
  kinds?: readonly string[],
): boolean {
  if (!events) return false;
  return events.some((e) => {
    if (e.decision !== 'DENY') return false;
    if (!kinds || kinds.length === 0) return true;
    return e.kind !== undefined && kinds.includes(e.kind);
  });
}

/**
 * Deterministic Trust Score from existing execution / policy / approval /
 * cost evidence. Pure — Runtime computes; workers never self-assert.
 */
export function computeAgentTrustScore(
  evidence: AgentTrustScoreEvidence,
): AgentTrustScore {
  const computedAt = evidence.computedAt ?? new Date().toISOString();
  const status = evidence.executionStatus;

  // --- taskCompletion ---
  let taskPassed = false;
  let taskScore: number | null = null;
  let taskIncomplete = false;
  const taskEvidence: string[] = [`execution.status=${status}`];

  if (NON_TERMINAL.has(status)) {
    taskIncomplete = true;
    taskEvidence.push('task=incomplete');
  } else if (status === 'succeeded') {
    if (evidence.outcomeStatus === 'failed') {
      taskPassed = false;
      taskScore = 0;
      taskEvidence.push('outcome.status=failed');
    } else if (
      evidence.evaluationPresent === true &&
      evidence.evaluationSuccess === false
    ) {
      taskPassed = false;
      taskScore = 0;
      taskEvidence.push('evaluation.success=false');
    } else if (
      evidence.evaluationPresent === true &&
      evidence.evaluationSuccess === true
    ) {
      taskPassed = true;
      taskScore = 1;
      taskEvidence.push('evaluation.success=true');
    } else {
      // Succeeded without evaluation — pass with penalty later
      taskPassed = true;
      taskScore = 1;
      taskEvidence.push('evaluation=absent');
    }
  } else {
    taskPassed = false;
    taskScore = 0;
    taskEvidence.push('task=failed_or_denied');
  }

  // --- toolCorrectness ---
  const toolsUsed = evidence.toolsUsed ?? [];
  const allowedTools = evidence.allowedTools;
  const toolDeny = hasDeny(evidence.policyEvents, ['tool']);
  const toolEvidence: string[] = [];
  let toolPassed = true;
  let toolScore: number | null = 1;
  let toolAllowListAbsent = false;

  if (toolDeny) {
    toolPassed = false;
    toolScore = 0;
    toolEvidence.push('policy.tool=DENY');
  }
  if (allowedTools && allowedTools.length > 0) {
    const allow = new Set(allowedTools.map(String));
    const bad = toolsUsed.filter((t) => !allow.has(String(t)));
    if (bad.length > 0) {
      toolPassed = false;
      toolScore = 0;
      toolEvidence.push(`tools.outsideAllowList=[${bad.join(',')}]`);
    } else {
      toolEvidence.push('tools.withinAllowList');
    }
  } else {
    toolAllowListAbsent = true;
    toolEvidence.push('toolAllowList=absent');
    if (toolDeny) {
      toolPassed = false;
    }
  }
  if (
    evidence.qualityScore !== undefined &&
    evidence.qualityScore < 0.5
  ) {
    toolPassed = false;
    toolScore = evidence.qualityScore;
    toolEvidence.push(`qualityScore=${evidence.qualityScore}`);
  }
  if (toolEvidence.length === 0) toolEvidence.push('tools=ok');

  // --- permissionCompliance (hard) ---
  const permDeny =
    evidence.authorizeDecision === 'DENY' ||
    status === 'denied' ||
    hasDeny(evidence.policyEvents, [
      'permission',
      'data-scope',
      'tool',
      'tenant-scope',
      'identity',
      'action-tier',
    ]);
  const permPassed = !permDeny;
  const permEvidence = [
    `authorize=${evidence.authorizeDecision ?? 'unknown'}`,
    permPassed ? 'permission=ok' : 'permission=DENY',
  ];

  // --- humanGateCompliance (hard) ---
  let gatePassed = true;
  const gateEvidence: string[] = [];
  if (evidence.gateRequired === true) {
    if (evidence.approvalGranted === true && evidence.approvalByHuman !== false) {
      gatePassed = true;
      gateEvidence.push('gate=granted_by_human');
    } else if (evidence.approvalGranted === true && evidence.approvalByHuman === false) {
      gatePassed = false;
      gateEvidence.push('gate=non_human_approver');
    } else {
      gatePassed = false;
      gateEvidence.push('gate=required_not_granted');
    }
  } else {
    gateEvidence.push('gate=not_required');
  }

  // --- executionCost ---
  const units = evidence.costUnits ?? null;
  const usd = evidence.costUsd ?? null;
  let costPassed = true;
  let costScore: number | null = null;
  const costEvidence: string[] = [];
  let budgetUnbounded = false;

  if (evidence.budgetCeiling !== undefined) {
    if (units === null) {
      costPassed = false;
      costEvidence.push('cost=missing_with_budget');
    } else if (units > evidence.budgetCeiling) {
      costPassed = false;
      costScore = 0;
      costEvidence.push(
        `cost.units=${units}>ceiling=${evidence.budgetCeiling}`,
      );
    } else {
      costPassed = true;
      costScore =
        evidence.budgetCeiling === 0
          ? 1
          : Math.max(0, 1 - units / evidence.budgetCeiling);
      costEvidence.push(
        `cost.units=${units}<=ceiling=${evidence.budgetCeiling}`,
      );
    }
  } else {
    budgetUnbounded = true;
    costPassed = true;
    costEvidence.push('budget=unbounded');
    if (units !== null) costScore = 1;
  }
  if (hasDeny(evidence.policyEvents, ['budget'])) {
    costPassed = false;
    costEvidence.push('policy.budget=DENY');
  }

  const dimensions: TrustDimension[] = [
    dim('taskCompletion', taskPassed, taskScore, taskEvidence),
    dim('toolCorrectness', toolPassed, toolScore, toolEvidence),
    dim(
      'permissionCompliance',
      permPassed,
      permPassed ? 1 : 0,
      permEvidence,
    ),
    dim(
      'humanGateCompliance',
      gatePassed,
      gatePassed ? 1 : 0,
      gateEvidence,
    ),
    dim('executionCost', costPassed, costScore, costEvidence),
  ];

  // Overall status
  let overall: (typeof TRUST_SCORE_STATUSES)[number];
  if (!permPassed || !gatePassed) {
    overall = 'untrusted';
  } else if (taskIncomplete) {
    overall = 'incomplete';
  } else if (
    taskPassed &&
    toolPassed &&
    costPassed &&
    !toolAllowListAbsent &&
    !budgetUnbounded &&
    evidence.evaluationPresent === true
  ) {
    overall = 'trusted';
  } else if (taskIncomplete) {
    overall = 'incomplete';
  } else {
    overall = 'degraded';
  }

  // Confidence
  let confidence = 100;
  if (!permPassed) confidence -= 25;
  if (!gatePassed) confidence -= 25;
  if (!taskPassed && !taskIncomplete) confidence -= 15;
  if (!toolPassed || toolAllowListAbsent) confidence -= 10;
  if (!costPassed || budgetUnbounded) confidence -= 10;
  if (status === 'succeeded' && evidence.evaluationPresent !== true) {
    confidence -= 10;
  }
  if (evidence.outcomeRequired && !evidence.outcomeStatus) {
    confidence -= 20;
  }
  if (taskIncomplete) confidence = Math.min(confidence, 40);
  confidence = Math.max(0, Math.min(100, confidence));

  return AgentTrustScore.parse({
    executionId: ExecutionId.parse(evidence.executionId),
    computedAt,
    status: overall,
    confidence,
    dimensions,
    cost: {
      units,
      usd,
      currency: usd !== null ? 'USD' : null,
    },
  });
}
