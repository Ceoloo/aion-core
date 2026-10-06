import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  createAgentActor,
  createRootAuthority,
  capability,
  type AuthorizationRequest,
} from '../../src/index.js';

const NOW = '2026-10-06T12:00:00.000Z';

function baseRequest(
  overrides: Partial<AuthorizationRequest> = {},
): AuthorizationRequest {
  return {
    tenantId: 'aion-internal',
    agentId: 'will-set',
    action: 'execute',
    capability: capability('crm.write'),
    riskLevel: 'R1',
    permissions: [],
    resourceRefs: [],
    resourceDataClasses: [],
    environment: 'staging',
    ...overrides,
  };
}

describe('PolicyEngine registry checks (AIO-44)', () => {
  const engine = new PolicyEngine({ policyId: 'test-registry' });

  it('denies suspended agents', () => {
    const agent = createAgentActor({
      name: 'Suspended',
      purpose: 'p',
      owner: 'o',
      tenantId: 'aion-internal',
      actionTier: 'execute',
      permissions: [capability('crm.write')],
      revocationState: 'suspended',
    });
    const decision = engine.authorize(
      baseRequest({ agentId: agent.agentId }),
      { actor: agent, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'registry')?.passed).toBe(
      false,
    );
    expect(decision.reason).toContain('revocation_state=suspended');
  });

  it('denies Execute when requireRegistryCompleteness and fields missing', () => {
    const agent = createAgentActor({
      name: 'Incomplete',
      purpose: 'p',
      owner: 'o',
      tenantId: 'aion-internal',
      actionTier: 'execute',
      permissions: [capability('crm.write')],
    });
    const decision = engine.authorize(
      baseRequest({ agentId: agent.agentId }),
      { actor: agent, now: NOW, requireRegistryCompleteness: true },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('SIS-AG-02');
  });

  it('allows Execute for complete registry under requireRegistryCompleteness', () => {
    const authority = createRootAuthority({
      subject: { kind: 'human', ref: 'o' },
      tenantId: 'aion-internal',
      grantReason: 'test grant',
      capabilities: [capability('crm.write')],
      dataScopes: ['crm.contacts'],
      createdAt: NOW,
    });
    const agent = createAgentActor({
      name: 'Complete',
      purpose: 'mutate allow-listed CRM',
      owner: 'o',
      domain: 'revenue',
      role: 'writer',
      tenantId: 'aion-internal',
      actionTier: 'execute',
      permissions: [capability('crm.write')],
      allowedData: ['crm.contacts'],
      delegatedAuthority: authority,
      policyVersion: 'sis-v1.0/test',
      executionEvidence: 'executions?actor_id={actor_id}',
      revocationState: 'active',
    });
    const decision = engine.authorize(
      baseRequest({
        agentId: agent.agentId,
        agentUri: agent.agentUri,
      }),
      {
        actor: agent,
        now: NOW,
        requireRegistryCompleteness: true,
      },
    );
    expect(decision.decision).toBe('ALLOW');
    expect(decision.checks.find((c) => c.kind === 'registry')?.passed).toBe(
      true,
    );
  });

  it('keeps legacy Execute paths working without requireRegistryCompleteness', () => {
    const agent = createAgentActor({
      name: 'Legacy',
      purpose: 'p',
      owner: 'o',
      tenantId: 'aion-internal',
      permissions: [capability('crm.write')],
    });
    const decision = engine.authorize(
      baseRequest({ agentId: agent.agentId }),
      { actor: agent, now: NOW },
    );
    expect(decision.decision).not.toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'registry')?.passed).toBe(
      true,
    );
  });
});
