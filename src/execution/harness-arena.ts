import type { HarnessId } from '../ports/harness-execution-provider.js';

/**
 * Harness Arena routing (ADR-011 follow-up).
 *
 * Mirrors the HarnessRouter Arena methodology for AION's own task classes:
 *   1. Gate on success (and optional quality) — a cheap failure is not a bargain.
 *   2. Among configurations that pass the gate, prefer lower cost.
 *   3. Break remaining ties on lower latency.
 *   4. Final ties break on a stable `harnessId|model` key for reproducibility.
 *
 * Selection is **routing / optimization, never authority**. The PolicyEngine
 * still authorizes the command; this only chooses which harness×model pair
 * should run work that policy already cleared. Recommendations are advisory
 * unless the composition root explicitly applies them (same posture as M007
 * capability routing).
 *
 * Shadow / canary posture (ADR-011): never duplicate a side-effectful command
 * across contenders. Score from prior isolated/eval runs or canary traffic only.
 */

/** Minimum observed runs before a configuration may win the arena. */
export const HARNESS_ARENA_MIN_SAMPLES = 3;

/** Default minimum success rate to pass the quality gate (inclusive). */
export const HARNESS_ARENA_MIN_SUCCESS_RATE = 1;

/** Default minimum average quality in [0, 1] to pass the gate. */
export const HARNESS_ARENA_MIN_QUALITY = 0;

/** One harness × model configuration under comparison. */
export interface HarnessConfigurationKey {
  harnessId: HarnessId;
  /** Vendor-neutral model id; omit when the harness default should run. */
  model?: string;
  /** Optional task-class label this scorecard applies to (e.g. "care-prep"). */
  taskClass?: string;
}

/** One observed run of a configuration — the arena sample unit. */
export interface HarnessConfigurationObservation {
  harnessId: HarnessId;
  model?: string;
  /** Whether the run met the task success contract. */
  success: boolean;
  /** Quality in [0, 1]. Defaults to 1 on success / 0 on failure when omitted. */
  qualityScore?: number;
  /** Abstract spend for the run (ExecutionResult.cost.units / HarnessUsage.units). */
  costUnits: number;
  /** End-to-end latency for the run. */
  latencyMs: number;
}

/** Aggregated scorecard for one configuration. */
export interface HarnessConfigurationScorecard {
  configuration: HarnessConfigurationKey;
  sampleCount: number;
  successRate: number;
  avgQualityScore: number;
  avgCostUnits: number;
  avgLatencyMs: number;
  /**
   * True when sampleCount ≥ minSamples AND success/quality gates pass.
   * Only eligible scorecards may win `recommended`.
   */
  eligible: boolean;
  /** True when success/quality gates pass, regardless of sample depth. */
  passedGate: boolean;
}

export interface HarnessArenaRecommendation {
  /** Task class these rankings apply to, when scoped. */
  taskClass?: string;
  rankings: Array<{ rank: number; scorecard: HarnessConfigurationScorecard }>;
  /** Top eligible configuration, if any. */
  recommended?: HarnessConfigurationKey;
  /**
   * Always present — callers keep the explicit `metadata.harnessId` (or other
   * deterministic selection) when no eligible winner exists.
   */
  fallback: 'deterministic';
  minSamples: number;
  minSuccessRate: number;
  minQuality: number;
  computedAt: string;
}

export interface RecommendHarnessConfigurationInput {
  observations: HarnessConfigurationObservation[];
  /** Scope rankings to one task class (propagated onto keys / recommendation). */
  taskClass?: string;
  minSamples?: number;
  /** Inclusive success-rate floor. Default 1 (every observed run succeeded). */
  minSuccessRate?: number;
  /** Inclusive average-quality floor in [0, 1]. Default 0 (no quality bar). */
  minQuality?: number;
  /** Manual override — wins `recommended` without mutating scorecards. */
  override?: HarnessConfigurationKey;
  computedAt?: string;
}

/** Stable identity for grouping / tie-breaks. */
export function harnessConfigurationIdentity(
  key: Pick<HarnessConfigurationKey, 'harnessId' | 'model'>,
): string {
  return `${key.harnessId}|${key.model ?? ''}`;
}

/**
 * Aggregate observations into per-configuration scorecards and mark gate/
 * sample eligibility. Does not rank.
 */
export function buildHarnessConfigurationScorecards(input: {
  observations: HarnessConfigurationObservation[];
  taskClass?: string;
  minSamples?: number;
  minSuccessRate?: number;
  minQuality?: number;
}): HarnessConfigurationScorecard[] {
  const minSamples = input.minSamples ?? HARNESS_ARENA_MIN_SAMPLES;
  const minSuccessRate = input.minSuccessRate ?? HARNESS_ARENA_MIN_SUCCESS_RATE;
  const minQuality = input.minQuality ?? HARNESS_ARENA_MIN_QUALITY;

  type Acc = {
    harnessId: HarnessId;
    model?: string;
    n: number;
    successes: number;
    sumQuality: number;
    sumCost: number;
    sumLatency: number;
  };

  const byKey = new Map<string, Acc>();
  for (const obs of input.observations) {
    const key = harnessConfigurationIdentity(obs);
    const quality =
      obs.qualityScore !== undefined
        ? obs.qualityScore
        : obs.success
          ? 1
          : 0;
    const existing = byKey.get(key);
    if (existing) {
      existing.n += 1;
      existing.successes += obs.success ? 1 : 0;
      existing.sumQuality += quality;
      existing.sumCost += obs.costUnits;
      existing.sumLatency += obs.latencyMs;
    } else {
      byKey.set(key, {
        harnessId: obs.harnessId,
        ...(obs.model !== undefined ? { model: obs.model } : {}),
        n: 1,
        successes: obs.success ? 1 : 0,
        sumQuality: quality,
        sumCost: obs.costUnits,
        sumLatency: obs.latencyMs,
      });
    }
  }

  return [...byKey.values()].map((acc) => {
    const successRate = acc.n > 0 ? acc.successes / acc.n : 0;
    const avgQualityScore = acc.n > 0 ? acc.sumQuality / acc.n : 0;
    const avgCostUnits = acc.n > 0 ? acc.sumCost / acc.n : 0;
    const avgLatencyMs = acc.n > 0 ? acc.sumLatency / acc.n : 0;
    const passedGate =
      successRate >= minSuccessRate && avgQualityScore >= minQuality;
    const configuration: HarnessConfigurationKey = {
      harnessId: acc.harnessId,
      ...(acc.model !== undefined ? { model: acc.model } : {}),
      ...(input.taskClass !== undefined ? { taskClass: input.taskClass } : {}),
    };
    return {
      configuration,
      sampleCount: acc.n,
      successRate,
      avgQualityScore,
      avgCostUnits,
      avgLatencyMs,
      passedGate,
      eligible: passedGate && acc.n >= minSamples,
    };
  });
}

/**
 * Rank scorecards Arena-style: eligible first, then lower cost, then lower
 * latency, then stable identity. Ineligible configurations stay listed (for
 * operator visibility) but cannot win.
 */
export function rankHarnessConfigurationScorecards(
  scorecards: HarnessConfigurationScorecard[],
): HarnessConfigurationScorecard[] {
  return [...scorecards].sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (a.avgCostUnits !== b.avgCostUnits) {
      return a.avgCostUnits - b.avgCostUnits;
    }
    if (a.avgLatencyMs !== b.avgLatencyMs) {
      return a.avgLatencyMs - b.avgLatencyMs;
    }
    return harnessConfigurationIdentity(a.configuration).localeCompare(
      harnessConfigurationIdentity(b.configuration),
    );
  });
}

/**
 * Build an Arena recommendation from observations. Returns no `recommended`
 * when no configuration is eligible — callers keep their deterministic route.
 */
export function recommendHarnessConfiguration(
  input: RecommendHarnessConfigurationInput,
): HarnessArenaRecommendation {
  const minSamples = input.minSamples ?? HARNESS_ARENA_MIN_SAMPLES;
  const minSuccessRate = input.minSuccessRate ?? HARNESS_ARENA_MIN_SUCCESS_RATE;
  const minQuality = input.minQuality ?? HARNESS_ARENA_MIN_QUALITY;

  const scorecards = buildHarnessConfigurationScorecards({
    observations: input.observations,
    ...(input.taskClass !== undefined ? { taskClass: input.taskClass } : {}),
    minSamples,
    minSuccessRate,
    minQuality,
  });
  const ranked = rankHarnessConfigurationScorecards(scorecards);
  const rankings = ranked.map((scorecard, i) => ({
    rank: i + 1,
    scorecard,
  }));

  let recommended: HarnessConfigurationKey | undefined = ranked.find(
    (s) => s.eligible,
  )?.configuration;
  if (input.override) {
    recommended = {
      ...input.override,
      ...(input.taskClass !== undefined && input.override.taskClass === undefined
        ? { taskClass: input.taskClass }
        : {}),
    };
  }

  return {
    ...(input.taskClass !== undefined ? { taskClass: input.taskClass } : {}),
    rankings,
    ...(recommended !== undefined ? { recommended } : {}),
    fallback: 'deterministic',
    minSamples,
    minSuccessRate,
    minQuality,
    computedAt: input.computedAt ?? new Date().toISOString(),
  };
}
