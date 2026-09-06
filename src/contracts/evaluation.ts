import { z } from 'zod';
import {
  AgentId,
  EvaluationId,
  ExecutionId,
  MissionId,
  newEvaluationId,
} from './identifiers.js';
import { ServiceKey } from './service.js';

/**
 * Mission 007 — Evaluations + Performance Routing contracts.
 *
 * EvaluationResult is durable per-execution judgment. Scorecards aggregate
 * those results into reproducible rankings. Routing recommendations are
 * **recommendation-only**: Runtime keeps the deterministic catalog route as
 * fallback and does not auto-switch providers until evidence thresholds and
 * earned autonomy (M008) say otherwise.
 */

/** Minimum samples before a candidate may win a recommendation. */
export const ROUTING_MIN_SAMPLES = 3;

/**
 * Fixed ranking weights — identical inputs must produce identical scores.
 * Do not randomize or time-vary these in M007.
 */
export const ROUTING_SCORE_WEIGHTS = {
  successRate: 40,
  quality: 35,
  /** Subtracted: higher cost → lower score. */
  cost: 12,
  /** Subtracted: higher latency (seconds) → lower score. */
  latencySeconds: 8,
  /** Subtracted: policy-denial rate penalty. */
  policyDenial: 25,
  /** Mild penalty for human interventions (friction). */
  humanIntervention: 5,
} as const;

/** Policy / gate event recorded against an evaluation. */
export const PolicyEventRecord = z.object({
  kind: z.string().min(1),
  decision: z.enum(['ALLOW', 'DENY', 'REQUIRE_APPROVAL']).optional(),
  detail: z.string().optional(),
});
export type PolicyEventRecord = z.infer<typeof PolicyEventRecord>;

/**
 * Durable evaluation of one execution — the M007 minimum data model.
 *
 * Field names are camelCase in Core; aion-data maps to snake_case columns.
 */
export const EvaluationResult = z.object({
  evaluationId: EvaluationId,
  executionId: ExecutionId,
  missionId: MissionId.optional(),
  /** Service catalog key `name@version` when known. */
  serviceKey: ServiceKey.optional(),
  serviceVersion: z.number().int().positive().optional(),
  agentId: AgentId.optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workflowVersion: z.string().min(1).optional(),
  /** Quality in [0, 1]. */
  qualityScore: z.number().min(0).max(1),
  success: z.boolean(),
  latencyMs: z.number().nonnegative(),
  /** Abstract cost units (ExecutionObject.cost.units). */
  totalCost: z.number().nonnegative(),
  humanIntervention: z.boolean().default(false),
  policyEvents: z.array(PolicyEventRecord).default([]),
  businessOutcome: z.string().optional(),
  economicValue: z.number().optional(),
  /** Tenant owning the evaluated execution — isolation key. */
  tenantId: z.string().min(1).optional(),
  evaluatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type EvaluationResult = z.infer<typeof EvaluationResult>;

/** Candidate identity for scorecard aggregation / ranking. */
export const RoutingCandidateKey = z.object({
  serviceKey: ServiceKey.optional(),
  /** Capability / job name used when serviceKey is absent (e.g. revenue.call.analyze). */
  capability: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workflowVersion: z.string().min(1).optional(),
  agentId: AgentId.optional(),
});
export type RoutingCandidateKey = z.infer<typeof RoutingCandidateKey>;

/** Aggregated performance scorecard for one routing candidate. */
export const CapabilityScorecard = z.object({
  candidate: RoutingCandidateKey,
  sampleCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgQualityScore: z.number().min(0).max(1),
  avgLatencyMs: z.number().nonnegative(),
  avgCost: z.number().nonnegative(),
  policyDenialRate: z.number().min(0).max(1),
  humanInterventionRate: z.number().min(0).max(1),
  attributedEconomicValue: z.number(),
  /** Deterministic composite ranking score (higher is better). */
  rankingScore: z.number(),
  /**
   * False when sampleCount < ROUTING_MIN_SAMPLES — insufficient evidence
   * cannot automatically win a recommendation.
   */
  eligible: z.boolean(),
  computedAt: z.string().datetime(),
});
export type CapabilityScorecard = z.infer<typeof CapabilityScorecard>;

export const RoutingOverride = z.object({
  candidate: RoutingCandidateKey,
  reason: z.string().min(1),
  setBy: z.string().min(1),
  setAt: z.string().datetime(),
});
export type RoutingOverride = z.infer<typeof RoutingOverride>;

/**
 * Recommendation-only routing result. Execution still uses the deterministic
 * catalog / registration fallback unless a caller explicitly honors `recommended`.
 */
export const RoutingRecommendation = z.object({
  request: z.object({
    tenantId: z.string().min(1),
    capability: z.string().min(1).optional(),
    serviceKey: ServiceKey.optional(),
  }),
  rankings: z.array(
    z.object({
      rank: z.number().int().positive(),
      scorecard: CapabilityScorecard,
    }),
  ),
  /** Top eligible candidate, if any. Absent when none are eligible. */
  recommended: RoutingCandidateKey.optional(),
  /** Always present — current deterministic route remains safe fallback. */
  fallback: z.literal('deterministic'),
  override: RoutingOverride.optional(),
  computedAt: z.string().datetime(),
  minSamples: z.number().int().positive().default(ROUTING_MIN_SAMPLES),
});
export type RoutingRecommendation = z.infer<typeof RoutingRecommendation>;

export interface CreateEvaluationInput {
  executionId: EvaluationResult['executionId'];
  missionId?: EvaluationResult['missionId'];
  serviceKey?: EvaluationResult['serviceKey'];
  serviceVersion?: EvaluationResult['serviceVersion'];
  agentId?: EvaluationResult['agentId'];
  provider?: EvaluationResult['provider'];
  model?: EvaluationResult['model'];
  workflowVersion?: EvaluationResult['workflowVersion'];
  qualityScore: number;
  success: boolean;
  latencyMs: number;
  totalCost: number;
  humanIntervention?: boolean;
  policyEvents?: PolicyEventRecord[];
  businessOutcome?: string;
  economicValue?: number;
  tenantId?: string;
  evaluatedAt?: string;
  metadata?: Record<string, unknown>;
  evaluationId?: EvaluationResult['evaluationId'];
}

/** Mint a validated EvaluationResult with defaults. */
export function createEvaluationResult(
  input: CreateEvaluationInput,
): EvaluationResult {
  return EvaluationResult.parse({
    evaluationId: input.evaluationId ?? newEvaluationId(),
    executionId: input.executionId,
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.serviceKey ? { serviceKey: input.serviceKey } : {}),
    ...(input.serviceVersion !== undefined
      ? { serviceVersion: input.serviceVersion }
      : {}),
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.workflowVersion
      ? { workflowVersion: input.workflowVersion }
      : {}),
    qualityScore: input.qualityScore,
    success: input.success,
    latencyMs: input.latencyMs,
    totalCost: input.totalCost,
    humanIntervention: input.humanIntervention ?? false,
    policyEvents: input.policyEvents ?? [],
    ...(input.businessOutcome
      ? { businessOutcome: input.businessOutcome }
      : {}),
    ...(input.economicValue !== undefined
      ? { economicValue: input.economicValue }
      : {}),
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    evaluatedAt: input.evaluatedAt ?? new Date().toISOString(),
    metadata: input.metadata ?? {},
  });
}

/**
 * Deterministic ranking score from aggregate rates.
 * Identical inputs → identical score (no randomness, no clock).
 */
export function computeRankingScore(input: {
  successRate: number;
  avgQualityScore: number;
  avgCost: number;
  avgLatencyMs: number;
  policyDenialRate: number;
  humanInterventionRate: number;
}): number {
  const w = ROUTING_SCORE_WEIGHTS;
  const latencySeconds = input.avgLatencyMs / 1000;
  const raw =
    w.successRate * input.successRate +
    w.quality * input.avgQualityScore -
    w.cost * input.avgCost -
    w.latencySeconds * latencySeconds -
    w.policyDenial * input.policyDenialRate -
    w.humanIntervention * input.humanInterventionRate;
  // Freeze floating noise for stable JSON / proof replay.
  return Math.round(raw * 1e6) / 1e6;
}

/** Build a scorecard from a candidate key + sample aggregates. */
export function buildCapabilityScorecard(input: {
  candidate: RoutingCandidateKey;
  sampleCount: number;
  successCount: number;
  sumQuality: number;
  sumLatencyMs: number;
  sumCost: number;
  policyDenialCount: number;
  humanInterventionCount: number;
  attributedEconomicValue: number;
  computedAt?: string;
  minSamples?: number;
}): CapabilityScorecard {
  const n = input.sampleCount;
  const successRate = n > 0 ? input.successCount / n : 0;
  const avgQualityScore = n > 0 ? input.sumQuality / n : 0;
  const avgLatencyMs = n > 0 ? input.sumLatencyMs / n : 0;
  const avgCost = n > 0 ? input.sumCost / n : 0;
  const policyDenialRate = n > 0 ? input.policyDenialCount / n : 0;
  const humanInterventionRate = n > 0 ? input.humanInterventionCount / n : 0;
  const minSamples = input.minSamples ?? ROUTING_MIN_SAMPLES;
  const rankingScore = computeRankingScore({
    successRate,
    avgQualityScore,
    avgCost,
    avgLatencyMs,
    policyDenialRate,
    humanInterventionRate,
  });
  return CapabilityScorecard.parse({
    candidate: input.candidate,
    sampleCount: n,
    successRate,
    avgQualityScore,
    avgLatencyMs,
    avgCost,
    policyDenialRate,
    humanInterventionRate,
    attributedEconomicValue: input.attributedEconomicValue,
    rankingScore,
    eligible: n >= minSamples,
    computedAt: input.computedAt ?? new Date().toISOString(),
  });
}

/**
 * Stable candidate identity string for grouping / sorting.
 * Empty optional dims are omitted so keys stay comparable.
 */
export function candidateIdentityKey(c: RoutingCandidateKey): string {
  const parts = [
    c.capability ?? '',
    c.serviceKey ?? '',
    c.provider ?? '',
    c.model ?? '',
    c.workflowVersion ?? '',
    c.agentId ?? '',
  ];
  return parts.join('|');
}

/**
 * Rank scorecards: eligible first by rankingScore desc, then ineligible.
 * Ties broken by candidateIdentityKey ascending for reproducibility.
 */
export function rankScorecards(
  scorecards: CapabilityScorecard[],
): CapabilityScorecard[] {
  return [...scorecards].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.rankingScore !== b.rankingScore) {
      return b.rankingScore - a.rankingScore;
    }
    return candidateIdentityKey(a.candidate).localeCompare(
      candidateIdentityKey(b.candidate),
    );
  });
}

/**
 * Build a recommendation from scorecards. Manual override wins the
 * `recommended` slot without mutating underlying scorecards.
 */
export function recommendRoute(input: {
  tenantId: string;
  capability?: string;
  serviceKey?: EvaluationResult['serviceKey'];
  scorecards: CapabilityScorecard[];
  override?: RoutingOverride;
  computedAt?: string;
  minSamples?: number;
}): RoutingRecommendation {
  const ranked = rankScorecards(input.scorecards);
  const rankings = ranked.map((scorecard, i) => ({
    rank: i + 1,
    scorecard,
  }));
  const topEligible = ranked.find((s) => s.eligible);
  let recommended: RoutingCandidateKey | undefined = topEligible?.candidate;
  if (input.override) {
    recommended = input.override.candidate;
  }
  return RoutingRecommendation.parse({
    request: {
      tenantId: input.tenantId,
      ...(input.capability ? { capability: input.capability } : {}),
      ...(input.serviceKey ? { serviceKey: input.serviceKey } : {}),
    },
    rankings,
    ...(recommended ? { recommended } : {}),
    fallback: 'deterministic',
    ...(input.override ? { override: input.override } : {}),
    computedAt: input.computedAt ?? new Date().toISOString(),
    minSamples: input.minSamples ?? ROUTING_MIN_SAMPLES,
  });
}

/** True when any policy event is a DENY (used when aggregating penalties). */
export function evaluationHasPolicyDenial(ev: EvaluationResult): boolean {
  return ev.policyEvents.some((e) => e.decision === 'DENY');
}
