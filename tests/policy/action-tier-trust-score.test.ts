import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  capability,
  createAgentActor,
  AuthorizationRequest,
  assertActionTierConsistentWithGrants,
  requiredActionTierForCapability,
  actionTierFromAutonomy,
  computeAgentTrustScore,
  newExecutionId,
} from '../../src/index.js';

describe('Action Tier classification (ADR-007)', () => {
  it('maps capability suffixes to Observe / Assist / Execute', () => {
    expect(requiredActionTierForCapability('inventory.vehicle.search')).toBe(
      'observe',
    );
    expect(requiredActionTierForCapability('crm.offer.recommend')).toBe(
      'assist',
    );
    expect(requiredActionTierForCapability('crm.appointment.schedule')).toBe(
      'execute',
    );
    expect(requiredActionTierForCapability('finance.refund.execute')).toBe(
      'execute',
    );
    // Unknown shapes fail closed as execute
    expect(requiredActionTierForCapability('mystery.op')).toBe('execute');
  });

  it('maps autonomy levels to default tiers', () => {
    expect(actionTierFromAutonomy('L0')).toBe('observe');
    expect(actionTierFromAutonomy('L1')).toBe('assist');
    expect(actionTierFromAutonomy('L2')).toBe('execute');
    expect(actionTierFromAutonomy('L4')).toBe('execute');
  });

  it('rejects Observe grants that include Execute capabilities', () => {
    const check = assertActionTierConsistentWithGrants({
      actionTier: 'observe',
      permissions: ['inventory.vehicle.search', 'crm.appointment.schedule'],
    });
    expect(check.ok).toBe(false);
    expect(check.detail).toContain('crm.appointment.schedule');
  });
});

describe('PolicyEngine.authorize — Observe cannot Execute', () => {
  const engine = new PolicyEngine({
    risk: {
      capabilityRisk: {
        'inventory.vehicle.search': 'R0',
        'crm.offer.recommend': 'R1',
        'crm.appointment.schedule': 'R2',
        'finance.payment.execute': 'R3',
      },
    },
  });

  it('DENY: Observe-tier agent cannot authorize Execute capability (even if permission wrongly granted)', () => {
    const observer = createAgentActor({
      name: 'dealer-observer',
      purpose: 'inventory awareness',
      owner: 'platform',
      // Deliberately over-granted permission — Action Tier must still DENY.
      permissions: [
        capability('inventory.vehicle.search'),
        capability('crm.appointment.schedule'),
      ],
      maxRiskLevel: 'R3',
      tenantId: 'dealer_a',
      domain: 'dealer',
      role: 'inventory-reader',
      autonomyLevel: 'L0',
      actionTier: 'observe',
    });
    const decision = engine.authorize(
      AuthorizationRequest.parse({
        agentId: observer.agentId,
        tenantId: 'dealer_a',
        capability: 'crm.appointment.schedule',
        action: 'invoke',
        riskLevel: 'R2',
      }),
      { actor: observer },
    );
    expect(decision.decision).toBe('DENY');
    const tier = decision.checks.find((c) => c.kind === 'action-tier');
    expect(tier?.passed).toBe(false);
    expect(tier?.detail).toMatch(/observe.*cannot perform execute/i);
  });

  it('ALLOW: Observe-tier agent may search inventory', () => {
    const observer = createAgentActor({
      name: 'dealer-observer',
      purpose: 'inventory awareness',
      owner: 'platform',
      permissions: [capability('inventory.vehicle.search')],
      maxRiskLevel: 'R1',
      tenantId: 'dealer_a',
      domain: 'dealer',
      role: 'inventory-reader',
      autonomyLevel: 'L0',
      actionTier: 'observe',
    });
    const decision = engine.authorize(
      AuthorizationRequest.parse({
        agentId: observer.agentId,
        tenantId: 'dealer_a',
        capability: 'inventory.vehicle.search',
        action: 'invoke',
        riskLevel: 'R0',
      }),
      { actor: observer },
    );
    expect(decision.decision).toBe('ALLOW');
    expect(decision.checks.find((c) => c.kind === 'action-tier')?.passed).toBe(
      true,
    );
  });

  it('DENY: Assist-tier agent cannot schedule (Execute)', () => {
    const assistant = createAgentActor({
      name: 'dealer-assistant',
      purpose: 'draft offers',
      owner: 'platform',
      permissions: [
        capability('crm.offer.recommend'),
        capability('crm.appointment.schedule'),
      ],
      maxRiskLevel: 'R2',
      tenantId: 'dealer_a',
      domain: 'dealer',
      role: 'offer-drafter',
      autonomyLevel: 'L1',
      actionTier: 'assist',
    });
    const decision = engine.authorize(
      AuthorizationRequest.parse({
        agentId: assistant.agentId,
        tenantId: 'dealer_a',
        capability: 'crm.appointment.schedule',
        action: 'invoke',
        riskLevel: 'R2',
      }),
      { actor: assistant },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'action-tier')?.passed).toBe(
      false,
    );
  });

  it('ALLOW: Assist-tier agent may recommend', () => {
    const assistant = createAgentActor({
      name: 'dealer-assistant',
      purpose: 'draft offers',
      owner: 'platform',
      permissions: [capability('crm.offer.recommend')],
      maxRiskLevel: 'R1',
      tenantId: 'dealer_a',
      domain: 'dealer',
      role: 'offer-drafter',
      autonomyLevel: 'L1',
      actionTier: 'assist',
    });
    const decision = engine.authorize(
      AuthorizationRequest.parse({
        agentId: assistant.agentId,
        tenantId: 'dealer_a',
        capability: 'crm.offer.recommend',
        action: 'invoke',
        riskLevel: 'R1',
      }),
      { actor: assistant },
    );
    expect(decision.decision).toBe('ALLOW');
  });

  it('derives Observe from L0 when actionTier omitted', () => {
    const observer = createAgentActor({
      name: 'implicit-observer',
      purpose: 'read only',
      owner: 'platform',
      permissions: [
        capability('inventory.vehicle.search'),
        capability('crm.appointment.schedule'),
      ],
      maxRiskLevel: 'R3',
      tenantId: 'dealer_a',
      domain: 'dealer',
      role: 'reader',
      autonomyLevel: 'L0',
    });
    const decision = engine.authorize(
      AuthorizationRequest.parse({
        agentId: observer.agentId,
        tenantId: 'dealer_a',
        capability: 'crm.appointment.schedule',
        action: 'invoke',
        riskLevel: 'R2',
      }),
      { actor: observer },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'action-tier')?.detail).toContain(
      'observe cannot perform execute',
    );
  });
});

describe('computeAgentTrustScore (ADR-006)', () => {
  const exe = () => newExecutionId();
  const at = '2026-09-14T15:00:00.000Z';

  it('marks untrusted when permissionCompliance fails', () => {
    const score = computeAgentTrustScore({
      executionId: exe(),
      computedAt: at,
      executionStatus: 'denied',
      authorizeDecision: 'DENY',
      policyEvents: [{ kind: 'action-tier', decision: 'DENY' }],
      evaluationPresent: true,
      evaluationSuccess: false,
      gateRequired: false,
      costUnits: 1,
      budgetCeiling: 10,
      allowedTools: ['tool_a'],
      toolsUsed: ['tool_a'],
    });
    expect(score.status).toBe('untrusted');
    expect(
      score.dimensions.find((d) => d.id === 'permissionCompliance')?.passed,
    ).toBe(false);
    expect(score.confidence).toBeLessThanOrEqual(75);
  });

  it('marks untrusted when human gate required but not granted', () => {
    const score = computeAgentTrustScore({
      executionId: exe(),
      computedAt: at,
      executionStatus: 'succeeded',
      authorizeDecision: 'ALLOW',
      evaluationPresent: true,
      evaluationSuccess: true,
      gateRequired: true,
      approvalGranted: false,
      costUnits: 2,
      budgetCeiling: 10,
      allowedTools: ['tool_a'],
      toolsUsed: ['tool_a'],
    });
    expect(score.status).toBe('untrusted');
    expect(
      score.dimensions.find((d) => d.id === 'humanGateCompliance')?.passed,
    ).toBe(false);
  });

  it('returns trusted when all five dimensions pass with full evidence', () => {
    const score = computeAgentTrustScore({
      executionId: exe(),
      computedAt: at,
      executionStatus: 'succeeded',
      authorizeDecision: 'ALLOW',
      evaluationPresent: true,
      evaluationSuccess: true,
      qualityScore: 0.9,
      gateRequired: true,
      approvalGranted: true,
      approvalByHuman: true,
      costUnits: 3,
      costUsd: 0.18,
      budgetCeiling: 10,
      allowedTools: ['tool_a'],
      toolsUsed: ['tool_a'],
      policyEvents: [],
    });
    expect(score.status).toBe('trusted');
    expect(score.confidence).toBeGreaterThanOrEqual(90);
    expect(score.cost.usd).toBe(0.18);
    expect(score.cost.currency).toBe('USD');
    expect(score.dimensions).toHaveLength(5);
    expect(score.dimensions.every((d) => d.passed)).toBe(true);
  });

  it('fails taskCompletion when outcome failed despite succeeded execution', () => {
    const score = computeAgentTrustScore({
      executionId: exe(),
      computedAt: at,
      executionStatus: 'succeeded',
      authorizeDecision: 'ALLOW',
      evaluationPresent: true,
      evaluationSuccess: true,
      outcomeStatus: 'failed',
      gateRequired: false,
      costUnits: 1,
      budgetCeiling: 5,
      allowedTools: ['tool_a'],
      toolsUsed: ['tool_a'],
    });
    expect(score.dimensions.find((d) => d.id === 'taskCompletion')?.passed).toBe(
      false,
    );
    expect(score.status).toBe('degraded');
  });
});
