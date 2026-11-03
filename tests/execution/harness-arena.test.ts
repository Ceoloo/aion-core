import { describe, it, expect } from 'vitest';
import {
  HARNESS_ARENA_MIN_SAMPLES,
  buildHarnessConfigurationScorecards,
  harnessConfigurationIdentity,
  rankHarnessConfigurationScorecards,
  recommendHarnessConfiguration,
  type HarnessConfigurationObservation,
} from '../../src/execution/harness-arena.js';

function obs(
  harnessId: string,
  model: string | undefined,
  partial: Partial<HarnessConfigurationObservation> &
    Pick<HarnessConfigurationObservation, 'success' | 'costUnits' | 'latencyMs'>,
): HarnessConfigurationObservation {
  return {
    harnessId,
    ...(model !== undefined ? { model } : {}),
    ...partial,
  };
}

/** n identical successful cheap/fast runs for a config. */
function successes(
  harnessId: string,
  model: string | undefined,
  n: number,
  costUnits: number,
  latencyMs: number,
): HarnessConfigurationObservation[] {
  return Array.from({ length: n }, () =>
    obs(harnessId, model, { success: true, costUnits, latencyMs, qualityScore: 1 }),
  );
}

describe('Harness Arena (ADR-011 routing optimization)', () => {
  it('gates on success before cost — a cheap failure cannot win', () => {
    const recommendation = recommendHarnessConfiguration({
      taskClass: 'care-prep',
      computedAt: '2026-10-19T00:00:00.000Z',
      observations: [
        ...successes('hermes', 'gpt-5.2', HARNESS_ARENA_MIN_SAMPLES, 0.47, 153_000),
        // Cheap but only 60% success — fails the default 100% gate.
        ...successes('claude-code', 'claude-opus-4.8', 3, 0.01, 10_000),
        obs('claude-code', 'claude-opus-4.8', {
          success: false,
          costUnits: 0.01,
          latencyMs: 10_000,
          qualityScore: 0,
        }),
        obs('claude-code', 'claude-opus-4.8', {
          success: false,
          costUnits: 0.01,
          latencyMs: 10_000,
          qualityScore: 0,
        }),
      ],
    });

    expect(recommendation.recommended).toEqual({
      harnessId: 'hermes',
      model: 'gpt-5.2',
      taskClass: 'care-prep',
    });
    const claude = recommendation.rankings.find(
      (r) => r.scorecard.configuration.harnessId === 'claude-code',
    );
    expect(claude?.scorecard.passedGate).toBe(false);
    expect(claude?.scorecard.eligible).toBe(false);
  });

  it('among gate-passers prefers lower cost, then lower latency', () => {
    const recommendation = recommendHarnessConfiguration({
      computedAt: '2026-10-19T00:00:00.000Z',
      observations: [
        ...successes('codex', 'gpt-5.2', 3, 1.5, 60_000),
        ...successes('hermes', 'gpt-5.2', 3, 1.0, 90_000),
        ...successes('hermes', 'claude-opus-4.8', 3, 1.0, 40_000),
      ],
    });

    // Both hermes configs cost 1.0; the faster one wins. Codex is more expensive.
    expect(recommendation.recommended).toEqual({
      harnessId: 'hermes',
      model: 'claude-opus-4.8',
    });
    expect(recommendation.rankings.map((r) => harnessConfigurationIdentity(r.scorecard.configuration))).toEqual([
      'hermes|claude-opus-4.8',
      'hermes|gpt-5.2',
      'codex|gpt-5.2',
    ]);
  });

  it('requires min samples before a configuration is eligible', () => {
    const recommendation = recommendHarnessConfiguration({
      computedAt: '2026-10-19T00:00:00.000Z',
      observations: successes('hermes', 'gpt-5.2', 2, 0.5, 10_000),
    });
    expect(recommendation.recommended).toBeUndefined();
    expect(recommendation.fallback).toBe('deterministic');
    expect(recommendation.rankings[0]?.scorecard.passedGate).toBe(true);
    expect(recommendation.rankings[0]?.scorecard.eligible).toBe(false);
  });

  it('honors a manual override without mutating scorecard eligibility', () => {
    const recommendation = recommendHarnessConfiguration({
      computedAt: '2026-10-19T00:00:00.000Z',
      observations: successes('hermes', 'gpt-5.2', 3, 0.5, 10_000),
      override: { harnessId: 'codex', model: 'gpt-5.2' },
    });
    expect(recommendation.recommended).toEqual({
      harnessId: 'codex',
      model: 'gpt-5.2',
    });
    expect(recommendation.rankings[0]?.scorecard.configuration.harnessId).toBe('hermes');
  });

  it('defaults missing qualityScore from success and ranks stably on identity ties', () => {
    const scorecards = buildHarnessConfigurationScorecards({
      observations: [
        obs('a', 'm', { success: true, costUnits: 1, latencyMs: 100 }),
        obs('a', 'm', { success: true, costUnits: 1, latencyMs: 100 }),
        obs('a', 'm', { success: true, costUnits: 1, latencyMs: 100 }),
        obs('b', 'm', { success: true, costUnits: 1, latencyMs: 100 }),
        obs('b', 'm', { success: true, costUnits: 1, latencyMs: 100 }),
        obs('b', 'm', { success: true, costUnits: 1, latencyMs: 100 }),
      ],
    });
    const ranked = rankHarnessConfigurationScorecards(scorecards);
    expect(ranked.map((s) => s.configuration.harnessId)).toEqual(['a', 'b']);
    expect(ranked[0]?.avgQualityScore).toBe(1);
  });
});
