import { describe, it, expect } from 'vitest';
import {
  ROUTING_MIN_SAMPLES,
  buildCapabilityScorecard,
  candidateIdentityKey,
  computeRankingScore,
  createEvaluationResult,
  evaluationHasPolicyDenial,
  newExecutionId,
  newAgentId,
  rankScorecards,
  recommendRoute,
  formatServiceKey,
} from '../../src/index.js';

describe('Mission 007 evaluation + routing', () => {
  it('createEvaluationResult applies defaults and brands ids', () => {
    const ev = createEvaluationResult({
      executionId: newExecutionId(),
      qualityScore: 0.9,
      success: true,
      latencyMs: 1200,
      totalCost: 0.18,
      provider: 'provider-a',
      model: 'model-a',
      serviceKey: formatServiceKey('revenue.call.analyze', 1),
    });
    expect(ev.evaluationId.startsWith('evr_')).toBe(true);
    expect(ev.humanIntervention).toBe(false);
    expect(ev.policyEvents).toEqual([]);
    expect(ev.qualityScore).toBe(0.9);
  });

  it('identical aggregate inputs produce identical ranking scores', () => {
    const input = {
      successRate: 0.982,
      avgQualityScore: 0.94,
      avgCost: 0.18,
      avgLatencyMs: 1900,
      policyDenialRate: 0,
      humanInterventionRate: 0.05,
    };
    expect(computeRankingScore(input)).toBe(computeRankingScore(input));
    expect(computeRankingScore(input)).toBe(computeRankingScore({ ...input }));
  });

  it('insufficient sample size cannot be eligible / win', () => {
    const low = buildCapabilityScorecard({
      candidate: { provider: 'provider-c', model: 'cheap' },
      sampleCount: ROUTING_MIN_SAMPLES - 1,
      successCount: 2,
      sumQuality: 1.9,
      sumLatencyMs: 2000,
      sumCost: 0.1,
      policyDenialCount: 0,
      humanInterventionCount: 0,
      attributedEconomicValue: 0,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    const high = buildCapabilityScorecard({
      candidate: { provider: 'provider-a', model: 'solid' },
      sampleCount: ROUTING_MIN_SAMPLES,
      successCount: 2,
      sumQuality: 2.4,
      sumLatencyMs: 6000,
      sumCost: 0.6,
      policyDenialCount: 0,
      humanInterventionCount: 0,
      attributedEconomicValue: 10,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    expect(low.eligible).toBe(false);
    expect(high.eligible).toBe(true);
    const rec = recommendRoute({
      tenantId: 'aion-systems',
      capability: 'revenue.call.analyze',
      scorecards: [low, high],
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    expect(rec.recommended?.provider).toBe('provider-a');
    expect(rec.fallback).toBe('deterministic');
    expect(rec.rankings[0]?.scorecard.eligible).toBe(true);
  });

  it('failed and policy-denying executions lower ranking vs clean successes', () => {
    const clean = buildCapabilityScorecard({
      candidate: { provider: 'clean' },
      sampleCount: 5,
      successCount: 5,
      sumQuality: 4.5,
      sumLatencyMs: 5000,
      sumCost: 1,
      policyDenialCount: 0,
      humanInterventionCount: 0,
      attributedEconomicValue: 50,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    const dirty = buildCapabilityScorecard({
      candidate: { provider: 'dirty' },
      sampleCount: 5,
      successCount: 2,
      sumQuality: 2.0,
      sumLatencyMs: 5000,
      sumCost: 1,
      policyDenialCount: 3,
      humanInterventionCount: 2,
      attributedEconomicValue: 5,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    expect(clean.rankingScore).toBeGreaterThan(dirty.rankingScore);
    const ranked = rankScorecards([dirty, clean]);
    expect(ranked[0]?.candidate.provider).toBe('clean');
  });

  it('manual override sets recommended without changing scorecard order', () => {
    const a = buildCapabilityScorecard({
      candidate: { provider: 'a' },
      sampleCount: 5,
      successCount: 5,
      sumQuality: 4.7,
      sumLatencyMs: 4000,
      sumCost: 0.5,
      policyDenialCount: 0,
      humanInterventionCount: 0,
      attributedEconomicValue: 20,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    const b = buildCapabilityScorecard({
      candidate: { provider: 'b' },
      sampleCount: 5,
      successCount: 4,
      sumQuality: 4.0,
      sumLatencyMs: 5000,
      sumCost: 0.8,
      policyDenialCount: 0,
      humanInterventionCount: 0,
      attributedEconomicValue: 10,
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    const rec = recommendRoute({
      tenantId: 'aion-systems',
      scorecards: [a, b],
      override: {
        candidate: { provider: 'b' },
        reason: 'ops prefer provider-b for this tenant',
        setBy: 'human:ops',
        setAt: '2026-09-06T22:00:00.000Z',
      },
      computedAt: '2026-09-06T22:00:00.000Z',
    });
    expect(rec.recommended?.provider).toBe('b');
    expect(rec.rankings[0]?.scorecard.candidate.provider).toBe('a');
    expect(rec.override?.reason).toContain('ops prefer');
  });

  it('evaluationHasPolicyDenial detects DENY events', () => {
    const ev = createEvaluationResult({
      executionId: newExecutionId(),
      agentId: newAgentId(),
      qualityScore: 0.5,
      success: false,
      latencyMs: 100,
      totalCost: 0,
      policyEvents: [{ kind: 'policy.denied', decision: 'DENY', detail: 'budget' }],
    });
    expect(evaluationHasPolicyDenial(ev)).toBe(true);
    expect(candidateIdentityKey({ provider: 'x', model: 'y' })).toBe('||x|y||');
  });
});
