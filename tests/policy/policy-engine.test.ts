import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  Command,
  capability,
  createAgentActor,
  createHumanActor,
  newRequestId,
  newCommandId,
  ManualClock,
  type Actor,
  type RiskLevel,
} from '../../src/index.js';

const clock = new ManualClock();

function command(overrides: {
  actor: Actor;
  capability: string;
  riskLevel?: RiskLevel;
  toolId?: string;
}): Command {
  return Command.parse({
    commandId: newCommandId(),
    requestId: newRequestId(),
    name: 'TestCommand',
    actor: overrides.actor,
    capability: capability(overrides.capability),
    ...(overrides.riskLevel ? { riskLevel: overrides.riskLevel } : {}),
    ...(overrides.toolId ? { toolId: overrides.toolId } : {}),
    createdAt: clock.isoNow(),
  });
}

describe('PolicyEngine', () => {
  it('ALLOWs a permitted low-risk action', () => {
    const engine = new PolicyEngine(
      { risk: { capabilityRisk: { 'research.summary': 'R1' } } },
      { clock },
    );
    const actor = createAgentActor({
      name: 'A',
      purpose: 'p',
      owner: 'o',
      permissions: [capability('research.summary')],
      maxRiskLevel: 'R2',
    });
    const decision = engine.evaluate(
      command({ actor, capability: 'research.summary' }),
    );
    expect(decision.decision).toBe('ALLOW');
    expect(decision.riskLevel).toBe('R1');
    expect(decision.requiresApproval).toBe(false);
    expect(decision.checks.find((c) => c.kind === 'permission')?.passed).toBe(true);
  });

  it('DENYs a capability the actor is not granted (deny by default)', () => {
    const engine = new PolicyEngine({}, { clock });
    const actor = createAgentActor({
      name: 'A',
      purpose: 'p',
      owner: 'o',
      permissions: [capability('research.summary')],
    });
    const decision = engine.evaluate(
      command({ actor, capability: 'deployment.execute' }),
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toMatch(/not granted/);
  });

  it('DENYs a forbidden capability even if otherwise granted', () => {
    const engine = new PolicyEngine({}, { clock });
    const actor = createAgentActor({
      name: 'A',
      purpose: 'p',
      owner: 'o',
      permissions: [capability('email.send')],
      forbiddenCapabilities: [capability('email.send')],
    });
    const decision = engine.evaluate(
      command({ actor, capability: 'email.send' }),
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toMatch(/forbidden/);
  });

  it('REQUIRE_APPROVAL for a high-risk (R3) action', () => {
    const engine = new PolicyEngine(
      { risk: { capabilityRisk: { 'deployment.execute': 'R3' } } },
      { clock },
    );
    const actor = createAgentActor({
      name: 'Deployer',
      purpose: 'deploy',
      owner: 'o',
      permissions: [capability('deployment.execute')],
      maxRiskLevel: 'R3',
    });
    const decision = engine.evaluate(
      command({ actor, capability: 'deployment.execute' }),
    );
    expect(decision.decision).toBe('REQUIRE_APPROVAL');
    expect(decision.riskLevel).toBe('R3');
    expect(decision.requiresApproval).toBe(true);
  });

  it('DENYs when action risk exceeds the actor ceiling', () => {
    const engine = new PolicyEngine(
      { risk: { capabilityRisk: { 'email.send': 'R3' } } },
      { clock },
    );
    const actor = createAgentActor({
      name: 'Capped',
      purpose: 'p',
      owner: 'o',
      permissions: [capability('email.send')],
      maxRiskLevel: 'R2',
    });
    const decision = engine.evaluate(
      command({ actor, capability: 'email.send' }),
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toMatch(/exceeds/);
    expect(
      decision.checks.find((c) => c.kind === 'risk-allowance')?.passed,
    ).toBe(false);
  });

  it('gates an R2 capability only when policy marks it gated', () => {
    const actor = createHumanActor({
      name: 'H',
      permissions: [capability('email.send')],
      maxRiskLevel: 'R3',
    });
    const ungated = new PolicyEngine(
      { risk: { capabilityRisk: { 'email.send': 'R2' } } },
      { clock },
    );
    expect(
      ungated.evaluate(command({ actor, capability: 'email.send' })).decision,
    ).toBe('ALLOW');

    const gated = new PolicyEngine(
      {
        risk: { capabilityRisk: { 'email.send': 'R2' } },
        gatedCapabilities: [capability('email.send')],
      },
      { clock },
    );
    expect(
      gated.evaluate(command({ actor, capability: 'email.send' })).decision,
    ).toBe('REQUIRE_APPROVAL');
  });

  it('DENYs when a targeted tool is not in the actor allow-list', () => {
    const engine = new PolicyEngine({}, { clock });
    const actor = createAgentActor({
      name: 'A',
      purpose: 'p',
      owner: 'o',
      permissions: [capability('research.summary')],
    });
    const decision = engine.evaluate(
      command({ actor, capability: 'research.summary', toolId: 'tool_x' }),
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'tool')?.passed).toBe(false);
  });
});
