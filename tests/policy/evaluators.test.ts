import { describe, it, expect } from 'vitest';
import {
  RiskEvaluator,
  PermissionEvaluator,
  capability,
  createAgentActor,
  maxRisk,
  highestRisk,
  riskGreaterThan,
} from '../../src/index.js';

describe('risk model helpers', () => {
  it('orders and maxes risk levels', () => {
    expect(maxRisk('R1', 'R3')).toBe('R3');
    expect(maxRisk('R2', 'R0')).toBe('R2');
    expect(highestRisk(['R0', 'R2', 'R1'])).toBe('R2');
    expect(highestRisk([])).toBe('R0');
    expect(riskGreaterThan('R3', 'R2')).toBe(true);
    expect(riskGreaterThan('R1', 'R1')).toBe(false);
  });
});

describe('RiskEvaluator', () => {
  it('classifies to the highest available signal, never lowering', () => {
    const evaluator = new RiskEvaluator({
      capabilityRisk: { 'email.send': 'R2' },
      defaultRisk: 'R1',
    });
    // declared R3 raises above capability R2
    expect(
      evaluator.classify({
        capability: capability('email.send'),
        declaredRisk: 'R3',
      }).riskLevel,
    ).toBe('R3');
    // declared R0 cannot lower capability R2
    expect(
      evaluator.classify({
        capability: capability('email.send'),
        declaredRisk: 'R0',
      }).riskLevel,
    ).toBe('R2');
    // unmapped capability falls to default
    expect(
      evaluator.classify({ capability: capability('unknown.thing') }).riskLevel,
    ).toBe('R1');
  });
});

describe('PermissionEvaluator', () => {
  const evaluator = new PermissionEvaluator();
  const actor = createAgentActor({
    name: 'A',
    purpose: 'p',
    owner: 'o',
    permissions: [capability('research.summary')],
    forbiddenCapabilities: [capability('email.send')],
  });

  it('permits a granted capability', () => {
    expect(
      evaluator.evaluateCapability(actor, capability('research.summary'))
        .permitted,
    ).toBe(true);
  });

  it('denies an ungranted capability', () => {
    expect(
      evaluator.evaluateCapability(actor, capability('crm.update')).permitted,
    ).toBe(false);
  });

  it('denies a forbidden capability', () => {
    expect(
      evaluator.evaluateCapability(actor, capability('email.send')).permitted,
    ).toBe(false);
  });
});
