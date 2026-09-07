import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AutonomyLevel, AUTONOMY_LEVELS } from './autonomy.js';
import { AgentId, EvaluationId } from './identifiers.js';
import { ServiceKey } from './service.js';
import { RiskLevel } from './risk.js';
import { Capability } from './capability.js';

/**
 * Mission 008 — Earned Autonomy Policy.
 *
 * Autonomy is granted to a specific agent × service × tenant × environment
 * combination based on observed performance and risk.
 *
 * HARD RULE: Performance can earn autonomy only inside policy limits.
 * Performance must never override risk policy (R3 is never waived).
 */

export const AUTONOMY_ENVIRONMENTS = ['staging', 'production'] as const;
export const AutonomyEnvironment = z.enum(AUTONOMY_ENVIRONMENTS);
export type AutonomyEnvironment = z.infer<typeof AutonomyEnvironment>;

export const AUTONOMY_GRANT_STATUSES = [
  'active',
  'revoked',
  'expired',
  'superseded',
] as const;
export const AutonomyGrantStatus = z.enum(AUTONOMY_GRANT_STATUSES);
export type AutonomyGrantStatus = z.infer<typeof AutonomyGrantStatus>;

/** Branded grant id (`agr_…`). */
export const AutonomyGrantId = z.string().min(1).brand('AutonomyGrantId');
export type AutonomyGrantId = z.infer<typeof AutonomyGrantId>;

export function newAutonomyGrantId(): AutonomyGrantId {
  return `agr_${randomUUID()}` as AutonomyGrantId;
}

/**
 * Conservative, deterministic promotion thresholds (M008 MVP).
 * Identical evidence → identical eligibility.
 */
export const AUTONOMY_PROMOTION_THRESHOLDS = {
  L2: {
    minExecutions: 5,
    successRate: 0.9,
    maxPolicyViolationRate: 0.05,
    maxHumanInterventionRate: 0.4,
    maxRollbackRate: 0.05,
    minEvalScore: 0.8,
    maxCostVariance: 2.0,
  },
  L3: {
    minExecutions: 10,
    successRate: 0.95,
    maxPolicyViolationRate: 0.02,
    maxHumanInterventionRate: 0.2,
    maxRollbackRate: 0.02,
    minEvalScore: 0.88,
    maxCostVariance: 1.5,
  },
  /** User bar: >=25 exec, >=98% success, 0 policy violations, … */
  L4: {
    minExecutions: 25,
    successRate: 0.98,
    maxPolicyViolationRate: 0,
    maxHumanInterventionRate: 0.1,
    maxRollbackRate: 0.01,
    minEvalScore: 0.92,
    maxCostVariance: 1.25,
  },
} as const;

const RISK_ORDER: RiskLevel[] = ['R0', 'R1', 'R2', 'R3'];

function riskAtMost(have: RiskLevel, max: RiskLevel): boolean {
  return RISK_ORDER.indexOf(have) <= RISK_ORDER.indexOf(max);
}

/** Evidence window aggregates for a scoped grant. */
export const AutonomyEvidence = z.object({
  sampleCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  policyViolationRate: z.number().min(0).max(1),
  rollbackRate: z.number().min(0).max(1).default(0),
  humanInterventionRate: z.number().min(0).max(1),
  /** Mean quality / eval score in [0,1]. */
  evalScore: z.number().min(0).max(1),
  /** Relative cost variance (stddev/mean); 0 when mean is 0. */
  costVariance: z.number().nonnegative().default(0),
  evaluationIds: z.array(EvaluationId).default([]),
  windowStartedAt: z.string().datetime().optional(),
  windowEndedAt: z.string().datetime().optional(),
});
export type AutonomyEvidence = z.infer<typeof AutonomyEvidence>;

/**
 * AutonomyGrant — scoped earned autonomy. Never a blanket agent-wide raise.
 */
export const AutonomyGrant = z.object({
  grantId: AutonomyGrantId,
  agentId: AgentId,
  serviceKey: ServiceKey.optional(),
  capability: Capability.optional(),
  tenantId: z.string().min(1),
  environment: AutonomyEnvironment,
  /** Currently granted / enforced level for this scope. */
  currentLevel: AutonomyLevel,
  /** Highest level evidence currently supports. */
  eligibleLevel: AutonomyLevel,
  evidence: AutonomyEvidence,
  status: AutonomyGrantStatus.default('active'),
  grantReason: z.string().min(1),
  grantedBy: z.enum(['policy', 'human']).default('policy'),
  /** Explicit allow for L4 in this tenant/env (required for any L4 grant). */
  l4Allowed: z.boolean().default(false),
  /** Highest risk class this grant may waive gates for (never R3). */
  maxWaiveRisk: RiskLevel.default('R2'),
  lastReviewedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().optional(),
  revokeReason: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type AutonomyGrant = z.infer<typeof AutonomyGrant>;

export interface AutonomyEvidenceInput {
  sampleCount: number;
  successCount: number;
  policyViolationCount: number;
  rollbackCount?: number;
  humanInterventionCount: number;
  sumEvalScore: number;
  costs?: number[];
  evaluationIds?: EvaluationId[];
  windowStartedAt?: string;
  windowEndedAt?: string;
}

export function buildAutonomyEvidence(
  input: AutonomyEvidenceInput,
): AutonomyEvidence {
  const n = input.sampleCount;
  const meanCost =
    input.costs && input.costs.length > 0
      ? input.costs.reduce((a, b) => a + b, 0) / input.costs.length
      : 0;
  let costVariance = 0;
  if (input.costs && input.costs.length > 1 && meanCost > 0) {
    const variance =
      input.costs.reduce((acc, c) => acc + (c - meanCost) ** 2, 0) /
      input.costs.length;
    costVariance = Math.sqrt(variance) / meanCost;
  }
  return AutonomyEvidence.parse({
    sampleCount: n,
    successRate: n > 0 ? input.successCount / n : 0,
    policyViolationRate: n > 0 ? input.policyViolationCount / n : 0,
    rollbackRate: n > 0 ? (input.rollbackCount ?? 0) / n : 0,
    humanInterventionRate: n > 0 ? input.humanInterventionCount / n : 0,
    evalScore: n > 0 ? input.sumEvalScore / n : 0,
    costVariance: Math.round(costVariance * 1e6) / 1e6,
    evaluationIds: input.evaluationIds ?? [],
    ...(input.windowStartedAt
      ? { windowStartedAt: input.windowStartedAt }
      : {}),
    ...(input.windowEndedAt ? { windowEndedAt: input.windowEndedAt } : {}),
  });
}

function levelIndex(level: AutonomyLevel): number {
  return AUTONOMY_LEVELS.indexOf(level);
}

export function autonomyLevelAtLeast(
  have: AutonomyLevel,
  need: AutonomyLevel,
): boolean {
  return levelIndex(have) >= levelIndex(need);
}

export function minAutonomyLevel(
  a: AutonomyLevel,
  b: AutonomyLevel,
): AutonomyLevel {
  return levelIndex(a) <= levelIndex(b) ? a : b;
}

function meetsThreshold(
  evidence: AutonomyEvidence,
  t: {
    minExecutions: number;
    successRate: number;
    maxPolicyViolationRate: number;
    maxHumanInterventionRate: number;
    maxRollbackRate: number;
    minEvalScore: number;
    maxCostVariance: number;
  },
): boolean {
  return (
    evidence.sampleCount >= t.minExecutions &&
    evidence.successRate >= t.successRate &&
    evidence.policyViolationRate <= t.maxPolicyViolationRate &&
    evidence.humanInterventionRate <= t.maxHumanInterventionRate &&
    evidence.rollbackRate <= t.maxRollbackRate &&
    evidence.evalScore >= t.minEvalScore &&
    evidence.costVariance <= t.maxCostVariance
  );
}

/**
 * Deterministic eligible level from evidence + risk/env gates.
 * Performance never proposes above what service risk / env allow.
 */
export function computeEligibleAutonomyLevel(input: {
  evidence: AutonomyEvidence;
  serviceRisk: RiskLevel;
  environment: AutonomyEnvironment;
  l4Allowed: boolean;
  agentCeiling?: AutonomyLevel;
}): AutonomyLevel {
  let eligible: AutonomyLevel = 'L1';
  const { evidence, serviceRisk, environment, l4Allowed } = input;

  // L2 — reversible work; R0/R1 services only.
  if (
    meetsThreshold(evidence, AUTONOMY_PROMOTION_THRESHOLDS.L2) &&
    riskAtMost(serviceRisk, 'R1')
  ) {
    eligible = 'L2';
  }

  // L3 — sensitive work still typically gated; evidence bar only.
  if (
    meetsThreshold(evidence, AUTONOMY_PROMOTION_THRESHOLDS.L3) &&
    serviceRisk !== 'R3'
  ) {
    eligible = 'L3';
  }

  // L4 — bounded autonomy; requires explicit l4Allowed + non-R3 service.
  // Production additionally requires l4Allowed (same flag — ops must opt in).
  if (
    meetsThreshold(evidence, AUTONOMY_PROMOTION_THRESHOLDS.L4) &&
    serviceRisk !== 'R3' &&
    l4Allowed &&
    (environment === 'staging' || environment === 'production')
  ) {
    eligible = 'L4';
  }

  if (input.agentCeiling) {
    eligible = minAutonomyLevel(eligible, input.agentCeiling);
  }
  return eligible;
}

export interface AutonomyEvaluateInput {
  grant?: AutonomyGrant;
  riskLevel: RiskLevel;
  /** Baseline policy would require approval without a grant. */
  baselineRequiresApproval: boolean;
  /** Manual force-reduce: treat as demoted to L1 for this decision. */
  manualDemote?: boolean;
}

export interface AutonomyEvaluateResult {
  decision: 'ALLOW' | 'REQUIRE_APPROVAL' | 'DENY';
  waivesApproval: boolean;
  effectiveLevel: AutonomyLevel;
  reason: string;
  detail: string;
}

/**
 * AutonomyPolicy.evaluate — decide whether an active grant may waive a human
 * gate. HARD RULE: R3 never waived.
 */
export function evaluateAutonomy(
  input: AutonomyEvaluateInput,
): AutonomyEvaluateResult {
  if (input.manualDemote) {
    return {
      decision: input.baselineRequiresApproval ? 'REQUIRE_APPROVAL' : 'ALLOW',
      waivesApproval: false,
      effectiveLevel: 'L1',
      reason: 'manual autonomy demotion enforced',
      detail: 'manual demote — approval policy restored',
    };
  }

  const grant = input.grant;
  const effectiveLevel =
    grant && grant.status === 'active' ? grant.currentLevel : 'L1';

  // R3 — never waive, regardless of grant performance.
  if (input.riskLevel === 'R3') {
    return {
      decision: input.baselineRequiresApproval ? 'REQUIRE_APPROVAL' : 'ALLOW',
      waivesApproval: false,
      effectiveLevel,
      reason:
        'R3 requires human gate — performance cannot override risk policy',
      detail: 'autonomy cannot waive R3',
    };
  }

  if (!grant || grant.status !== 'active') {
    return {
      decision: input.baselineRequiresApproval ? 'REQUIRE_APPROVAL' : 'ALLOW',
      waivesApproval: false,
      effectiveLevel: 'L1',
      reason: input.baselineRequiresApproval
        ? 'no active autonomy grant — approval required'
        : 'no grant needed',
      detail: 'no active AutonomyGrant',
    };
  }

  // Only L4 bounded autonomy may waive R0–R2 gates within maxWaiveRisk.
  // R3 is already rejected above — riskAtMost never includes R3 when max is R2.
  const waiveOk =
    autonomyLevelAtLeast(grant.currentLevel, 'L4') &&
    riskAtMost(input.riskLevel, grant.maxWaiveRisk);
  if (input.baselineRequiresApproval && waiveOk) {
    return {
      decision: 'ALLOW',
      waivesApproval: true,
      effectiveLevel: grant.currentLevel,
      reason: `earned autonomy ${grant.currentLevel} waives approval for ${input.riskLevel} within grant ${grant.grantId}`,
      detail: `autonomy-grant ${grant.grantId} level=${grant.currentLevel}`,
    };
  }

  return {
    decision: input.baselineRequiresApproval ? 'REQUIRE_APPROVAL' : 'ALLOW',
    waivesApproval: false,
    effectiveLevel: grant.currentLevel,
    reason: input.baselineRequiresApproval
      ? `grant ${grant.currentLevel} insufficient to waive ${input.riskLevel} approval`
      : 'allowed without autonomy waiver',
    detail: `grant level=${grant.currentLevel} waiver=${waiveOk}`,
  };
}

/** Immediate demotion target when evidence degrades or policy is violated. */
export function demoteAutonomyLevel(
  current: AutonomyLevel,
  reason: 'policy_violation' | 'evidence_degraded' | 'manual' | 'high_risk',
): AutonomyLevel {
  if (
    reason === 'policy_violation' ||
    reason === 'high_risk' ||
    reason === 'manual'
  ) {
    return 'L1';
  }
  const idx = levelIndex(current);
  if (idx <= 1) return 'L1';
  return AUTONOMY_LEVELS[idx - 1]!;
}

export interface CreateAutonomyGrantInput {
  agentId: AutonomyGrant['agentId'];
  tenantId: string;
  environment: AutonomyEnvironment;
  currentLevel: AutonomyLevel;
  eligibleLevel: AutonomyLevel;
  evidence: AutonomyEvidence;
  grantReason: string;
  serviceKey?: AutonomyGrant['serviceKey'];
  capability?: AutonomyGrant['capability'];
  grantedBy?: 'policy' | 'human';
  l4Allowed?: boolean;
  maxWaiveRisk?: RiskLevel;
  lastReviewedAt?: string;
  createdAt?: string;
  grantId?: AutonomyGrantId;
  metadata?: Record<string, unknown>;
}

export function createAutonomyGrant(
  input: CreateAutonomyGrantInput,
): AutonomyGrant {
  const now = input.createdAt ?? new Date().toISOString();
  return AutonomyGrant.parse({
    grantId: input.grantId ?? newAutonomyGrantId(),
    agentId: input.agentId,
    ...(input.serviceKey ? { serviceKey: input.serviceKey } : {}),
    ...(input.capability ? { capability: input.capability } : {}),
    tenantId: input.tenantId,
    environment: input.environment,
    currentLevel: input.currentLevel,
    eligibleLevel: input.eligibleLevel,
    evidence: input.evidence,
    status: 'active',
    grantReason: input.grantReason,
    grantedBy: input.grantedBy ?? 'policy',
    l4Allowed: input.l4Allowed ?? false,
    maxWaiveRisk: input.maxWaiveRisk ?? 'R2',
    lastReviewedAt: input.lastReviewedAt ?? now,
    createdAt: now,
    metadata: input.metadata ?? {},
  });
}

/** Stable scope key for persistence / lookup. */
export function autonomyGrantScopeKey(input: {
  tenantId: string;
  agentId: string;
  serviceKey?: string;
  capability?: string;
  environment: AutonomyEnvironment;
}): string {
  return [
    input.tenantId,
    input.agentId,
    input.serviceKey ?? input.capability ?? '*',
    input.environment,
  ].join('|');
}
