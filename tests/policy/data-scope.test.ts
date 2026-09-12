import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  capability,
  createAgentActor,
  createHumanActor,
  AuthorizationRequest,
} from '../../src/index.js';

describe('PolicyEngine.authorize data-scope (allowedData)', () => {
  const engine = new PolicyEngine({
    risk: {
      capabilityRisk: {
        'revenue.lead.research': 'R1',
      },
    },
  });

  it('DENY when agent lacks allowedData for requested resourceDataClasses', () => {
    const agent = createAgentActor({
      name: 'scoped-agent',
      purpose: 'test',
      owner: 'platform',
      permissions: [capability('revenue.lead.research')],
      maxRiskLevel: 'R2',
      tenantId: 'tenant_a',
      allowedData: ['crm.contact.public'],
      domain: 'revenue',
      role: 'researcher',
    });
    const request = AuthorizationRequest.parse({
      agentId: agent.agentId,
      tenantId: 'tenant_a',
      capability: 'revenue.lead.research',
      action: 'invoke',
      resourceDataClasses: ['crm.contact.public', 'crm.payment.secret'],
    });
    const decision = engine.authorize(request, { actor: agent });
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'data-scope')?.passed).toBe(false);
  });

  it('ALLOW when requested data classes ⊆ allowedData', () => {
    const agent = createAgentActor({
      name: 'scoped-agent',
      purpose: 'test',
      owner: 'platform',
      permissions: [capability('revenue.lead.research')],
      maxRiskLevel: 'R2',
      tenantId: 'tenant_a',
      allowedData: ['crm.contact.public', 'crm.payment.secret'],
      domain: 'revenue',
      role: 'researcher',
    });
    const request = AuthorizationRequest.parse({
      agentId: agent.agentId,
      tenantId: 'tenant_a',
      capability: 'revenue.lead.research',
      action: 'invoke',
      resourceDataClasses: ['crm.contact.public'],
    });
    const decision = engine.authorize(request, { actor: agent });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.checks.find((c) => c.kind === 'data-scope')?.passed).toBe(true);
  });

  it('skips data-scope when resourceDataClasses is empty (compat)', () => {
    const agent = createAgentActor({
      name: 'scoped-agent',
      purpose: 'test',
      owner: 'platform',
      permissions: [capability('revenue.lead.research')],
      maxRiskLevel: 'R2',
      tenantId: 'tenant_a',
      allowedData: [],
      domain: 'revenue',
      role: 'researcher',
    });
    const request = AuthorizationRequest.parse({
      agentId: agent.agentId,
      tenantId: 'tenant_a',
      capability: 'revenue.lead.research',
      action: 'invoke',
    });
    const decision = engine.authorize(request, { actor: agent });
    expect(decision.decision).toBe('ALLOW');
    expect(decision.checks.find((c) => c.kind === 'data-scope')).toBeUndefined();
  });

  it('does not apply data-scope to human actors', () => {
    const humanActor = createHumanActor({
      name: 'operator',
      permissions: [capability('revenue.lead.research')],
      maxRiskLevel: 'R3',
    });
    const request = AuthorizationRequest.parse({
      agentId: humanActor.actorId,
      tenantId: 'tenant_a',
      capability: 'revenue.lead.research',
      action: 'invoke',
      resourceDataClasses: ['crm.payment.secret'],
    });
    const decision = engine.authorize(request, { actor: humanActor });
    expect(decision.checks.find((c) => c.kind === 'data-scope')).toBeUndefined();
  });
});
