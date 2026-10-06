import { describe, it, expect } from 'vitest';
import {
  createAgentActor,
  createRootAuthority,
  capability,
  newToolId,
  registryCompleteness,
  toAgentRegistryRecord,
  reviewAgentRegistry,
  registryAllowsExecution,
  SIS_AG02_FIELDS,
  REVOCATION_STATES,
} from '../../src/index.js';

const NOW = '2026-10-06T12:00:00.000Z';
const crmTool = newToolId();

function completeAgent() {
  const agent = createAgentActor({
    name: 'RevenueCopilot',
    purpose: 'Governed CRM assist for tenant revenue ops.',
    owner: 'dana@aion.systems',
    domain: 'revenue',
    role: 'copilot',
    tenantId: 'aion-internal',
    actionTier: 'assist',
    permissions: [capability('crm.read')],
    allowedTools: [crmTool],
    allowedData: ['crm.contacts'],
    policyVersion: 'sis-v1.0/policy-2026-10-05',
    executionEvidence: 'executions?actor_id={actor_id}',
    revocationState: 'active',
    environment: 'production',
    credentialMethod: 'vaulted-short-lived',
    approvalRequirements: ['R3 human gate'],
  });
  const authority = createRootAuthority({
    subject: { kind: 'human', ref: 'dana@aion.systems' },
    tenantId: 'aion-internal',
    grantReason: 'Operator grant for Revenue Copilot assist tier',
    capabilities: [capability('crm.read')],
    tools: [crmTool],
    dataScopes: ['crm.contacts'],
    maxRiskLevel: 'R1',
    maxAutonomyLevel: 'L1',
    createdAt: NOW,
  });
  return { ...agent, delegatedAuthority: authority };
}

describe('Agent Identity Registry (AIO-44 / SIS-AG-02)', () => {
  it('exports the full SIS-AG-02 field set', () => {
    expect(SIS_AG02_FIELDS).toEqual([
      'agent_id',
      'human_owner',
      'business_purpose',
      'tenant',
      'permission_tier',
      'tools',
      'data_scope',
      'delegated_authority',
      'policy_version',
      'execution_evidence',
      'revocation_state',
    ]);
    expect(REVOCATION_STATES).toEqual(['active', 'suspended', 'revoked']);
  });

  it('defaults revocation_state to active on AgentActor', () => {
    const agent = createAgentActor({
      name: 'A',
      purpose: 'p',
      owner: 'o',
    });
    expect(agent.revocationState).toBe('active');
    expect(registryAllowsExecution(agent)).toBe(true);
  });

  it('reports incomplete registry for legacy agents', () => {
    const agent = createAgentActor({
      name: 'Legacy',
      purpose: 'old path',
      owner: 'ops',
      tenantId: 't1',
    });
    const result = registryCompleteness(agent);
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        'permission_tier',
        'delegated_authority',
        'policy_version',
        'execution_evidence',
      ]),
    );
  });

  it('projects a complete agent to the SIS inventory record', () => {
    const agent = completeAgent();
    expect(registryCompleteness(agent).ok).toBe(true);
    const record = toAgentRegistryRecord(agent);
    expect(record.agent_id).toMatch(/^agent:\/\/aion\/revenue\/copilot\//);
    expect(record.human_owner).toBe('dana@aion.systems');
    expect(record.permission_tier).toBe('assist');
    expect(record.tools).toEqual([crmTool]);
    expect(record.data_scope).toEqual(['crm.contacts']);
    expect(record.policy_version).toBe('sis-v1.0/policy-2026-10-05');
    expect(record.revocation_state).toBe('active');
    expect(record.environment).toBe('production');
  });

  it('fails governance review for unknown observed agents (SIS-AG-10)', () => {
    const review = reviewAgentRegistry({
      registered: [completeAgent()],
      observedAgentIds: [
        completeAgent().agentUri!,
        'agent://aion/revenue/shadow/unknown',
      ],
      now: NOW,
    });
    expect(review.ok).toBe(false);
    expect(review.findings.some((f) => f.code === 'unknown_agent')).toBe(true);
    expect(review.completeCount).toBe(1);
  });

  it('hard-stops Execute-tier agents with incomplete registry', () => {
    const incomplete = createAgentActor({
      name: 'ExecIncomplete',
      purpose: 'mutate crm',
      owner: 'ops',
      tenantId: 't1',
      actionTier: 'execute',
      permissions: [capability('crm.write')],
    });
    const review = reviewAgentRegistry({
      registered: [incomplete],
      now: NOW,
    });
    expect(review.ok).toBe(false);
    expect(
      review.findings.some((f) => f.code === 'execute_without_complete_registry'),
    ).toBe(true);
  });

  it('denies execution when revoked or suspended', () => {
    const revoked = {
      ...completeAgent(),
      revocationState: 'revoked' as const,
    };
    const suspended = {
      ...completeAgent(),
      revocationState: 'suspended' as const,
    };
    expect(registryAllowsExecution(revoked)).toBe(false);
    expect(registryAllowsExecution(suspended)).toBe(false);
  });
});
