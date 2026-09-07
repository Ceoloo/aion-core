import { describe, it, expect } from 'vitest';
import {
  AUTONOMY_PROMOTION_THRESHOLDS,
  AuthorizationRequest,
  buildAutonomyEvidence,
  computeEligibleAutonomyLevel,
  createAutonomyGrant,
  demoteAutonomyLevel,
  evaluateAutonomy,
  newAgentId,
  formatServiceKey,
  PolicyEngine,
  createAgentActor,
  capability,
} from '../../src/index.js';

const FIXED = '2026-09-06T23:30:00.000Z';

function evidenceFor(level: 'low' | 'L2' | 'L3' | 'L4') {
  if (level === 'low') {
    return buildAutonomyEvidence({
      sampleCount: 2,
      successCount: 2,
      policyViolationCount: 0,
      humanInterventionCount: 0,
      sumEvalScore: 1.9,
      costs: [1, 1],
    });
  }
  if (level === 'L2') {
    const t = AUTONOMY_PROMOTION_THRESHOLDS.L2;
    return buildAutonomyEvidence({
      sampleCount: t.minExecutions,
      successCount: t.minExecutions,
      policyViolationCount: 0,
      humanInterventionCount: 0,
      sumEvalScore: t.minEvalScore * t.minExecutions,
      costs: Array(t.minExecutions).fill(1),
    });
  }
  if (level === 'L3') {
    const t = AUTONOMY_PROMOTION_THRESHOLDS.L3;
    return buildAutonomyEvidence({
      sampleCount: t.minExecutions,
      successCount: t.minExecutions,
      policyViolationCount: 0,
      humanInterventionCount: 0,
      sumEvalScore: t.minEvalScore * t.minExecutions,
      costs: Array(t.minExecutions).fill(1),
    });
  }
  const t = AUTONOMY_PROMOTION_THRESHOLDS.L4;
  return buildAutonomyEvidence({
    sampleCount: t.minExecutions,
    successCount: t.minExecutions,
    policyViolationCount: 0,
    humanInterventionCount: 0,
    sumEvalScore: t.minEvalScore * t.minExecutions,
    costs: Array(t.minExecutions).fill(1),
  });
}

describe('Mission 008 earned autonomy', () => {
  it('identical evidence → identical eligible level (replay)', () => {
    const ev = evidenceFor('L4');
    const a = computeEligibleAutonomyLevel({
      evidence: ev,
      serviceRisk: 'R2',
      environment: 'staging',
      l4Allowed: true,
    });
    const b = computeEligibleAutonomyLevel({
      evidence: ev,
      serviceRisk: 'R2',
      environment: 'staging',
      l4Allowed: true,
    });
    expect(a).toBe('L4');
    expect(a).toBe(b);
  });

  it('low evidence stays at L1 (approval-required posture)', () => {
    expect(
      computeEligibleAutonomyLevel({
        evidence: evidenceFor('low'),
        serviceRisk: 'R1',
        environment: 'staging',
        l4Allowed: true,
      }),
    ).toBe('L1');
  });

  it('qualified evidence earns higher autonomy when l4Allowed', () => {
    expect(
      computeEligibleAutonomyLevel({
        evidence: evidenceFor('L4'),
        serviceRisk: 'R2',
        environment: 'staging',
        l4Allowed: true,
      }),
    ).toBe('L4');
    expect(
      computeEligibleAutonomyLevel({
        evidence: evidenceFor('L4'),
        serviceRisk: 'R2',
        environment: 'staging',
        l4Allowed: false,
      }),
    ).toBe('L3');
  });

  it('policy violations block L4 eligibility', () => {
    const t = AUTONOMY_PROMOTION_THRESHOLDS.L4;
    const ev = buildAutonomyEvidence({
      sampleCount: t.minExecutions,
      successCount: t.minExecutions,
      policyViolationCount: 1,
      humanInterventionCount: 0,
      sumEvalScore: t.minEvalScore * t.minExecutions,
      costs: Array(t.minExecutions).fill(1),
    });
    expect(
      computeEligibleAutonomyLevel({
        evidence: ev,
        serviceRisk: 'R2',
        environment: 'staging',
        l4Allowed: true,
      }),
    ).not.toBe('L4');
  });

  it('R3 never waived even with L4 grant', () => {
    const grant = createAutonomyGrant({
      agentId: newAgentId(),
      tenantId: 'aion-systems',
      environment: 'staging',
      currentLevel: 'L4',
      eligibleLevel: 'L4',
      evidence: evidenceFor('L4'),
      grantReason: 'proof',
      l4Allowed: true,
      createdAt: FIXED,
      lastReviewedAt: FIXED,
    });
    const result = evaluateAutonomy({
      grant,
      riskLevel: 'R3',
      baselineRequiresApproval: true,
    });
    expect(result.waivesApproval).toBe(false);
    expect(result.decision).toBe('REQUIRE_APPROVAL');
  });

  it('L4 grant waives R2 approval; demotion restores gate', () => {
    const grant = createAutonomyGrant({
      agentId: newAgentId(),
      tenantId: 'aion-systems',
      environment: 'staging',
      currentLevel: 'L4',
      eligibleLevel: 'L4',
      evidence: evidenceFor('L4'),
      grantReason: 'proof',
      l4Allowed: true,
      serviceKey: formatServiceKey('revenue.followup.execute', 1),
      createdAt: FIXED,
      lastReviewedAt: FIXED,
    });
    expect(
      evaluateAutonomy({
        grant,
        riskLevel: 'R2',
        baselineRequiresApproval: true,
      }).waivesApproval,
    ).toBe(true);
    expect(
      evaluateAutonomy({
        grant,
        riskLevel: 'R2',
        baselineRequiresApproval: true,
        manualDemote: true,
      }).waivesApproval,
    ).toBe(false);
    expect(demoteAutonomyLevel('L4', 'policy_violation')).toBe('L1');
  });

  it('PolicyEngine.authorize honors L4 grant on R2 and refuses R3', () => {
    const agent = createAgentActor({
      name: 'AutonomyAgent',
      purpose: 'm008',
      owner: 'test',
      domain: 'revenue',
      role: 'copilot',
      tenantId: 'aion-systems',
      permissions: [capability('revenue.followup.execute')],
      maxRiskLevel: 'R3',
      autonomyLevel: 'L4',
    });
    const grant = createAutonomyGrant({
      agentId: agent.agentId,
      tenantId: 'aion-systems',
      environment: 'staging',
      currentLevel: 'L4',
      eligibleLevel: 'L4',
      evidence: evidenceFor('L4'),
      grantReason: 'engine proof',
      l4Allowed: true,
      createdAt: FIXED,
      lastReviewedAt: FIXED,
    });
    const engine = new PolicyEngine({
      gatedCapabilities: [capability('revenue.followup.execute')],
    });

    const allowed = engine.authorize(
      AuthorizationRequest.parse({
        agentId: agent.agentId,
        tenantId: 'aion-systems',
        environment: 'staging',
        action: 'execute',
        capability: capability('revenue.followup.execute'),
        permissions: agent.permissions.map(String),
        riskLevel: 'R2',
      }),
      { actor: agent, autonomyGrant: grant },
    );
    expect(allowed.decision).toBe('ALLOW');
    expect(allowed.checks.some((c) => c.kind === 'autonomy-grant' && c.passed)).toBe(
      true,
    );

    const r3 = engine.authorize(
      AuthorizationRequest.parse({
        agentId: agent.agentId,
        tenantId: 'aion-systems',
        environment: 'staging',
        action: 'execute',
        capability: capability('revenue.followup.execute'),
        permissions: agent.permissions.map(String),
        riskLevel: 'R3',
      }),
      { actor: agent, autonomyGrant: grant },
    );
    expect(r3.decision).toBe('REQUIRE_APPROVAL');
    expect(r3.checks.some((c) => c.kind === 'autonomy-grant' && !c.passed)).toBe(
      true,
    );
  });
});
