import { describe, expect, it } from 'vitest';
import {
  AGENT_REGISTRY_MANDATORY_FIELDS,
  assertAgentRegistryComplete,
  buildAgentRegistryInventory,
  createAgentActor,
  inspectAgentRegistryCompleteness,
  isAgentExecutionAllowed,
  newAuthorityId,
  toAgentRegistryRecord,
  withAgentRevocationState,
} from '../../src/index.js';

describe('Agent Identity Registry (AIO-44 / SIS-AG-02)', () => {
  it('lists the mandatory registry fields from the Oct 5 brief', () => {
    expect(AGENT_REGISTRY_MANDATORY_FIELDS).toEqual([
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
  });

  it('flags incomplete agents (orphans fail governance review)', () => {
    const incomplete = createAgentActor({
      name: 'Partial Agent',
      purpose: 'draft only',
      owner: 'ops',
      // no tenant, no registry fields
      autonomyLevel: 'L1',
    });
    const inspection = inspectAgentRegistryCompleteness(incomplete);
    expect(inspection.ok).toBe(false);
    expect(inspection.missing).toEqual(
      expect.arrayContaining([
        'tenant',
        'delegated_authority',
        'policy_version',
        'execution_evidence',
        'revocation_state',
      ]),
    );
    expect(() => assertAgentRegistryComplete(incomplete)).toThrow(
      /missing registry fields/,
    );
  });

  it('projects a complete agent to a registry record', () => {
    const authorityId = newAuthorityId();
    const agent = createAgentActor({
      name: 'Revenue Pipeline Ops',
      purpose: 'Governed CRM assist for AION Systems',
      owner: 'operator-alex',
      domain: 'revenue',
      role: 'pipeline-ops',
      tenantId: 'aion-systems',
      autonomyLevel: 'L1',
      actionTier: 'assist',
      allowedTools: [],
      allowedData: ['crm.contacts.read'],
      delegatedAuthorityId: authorityId,
      delegatedAuthorityEvidence: `root grant ${authorityId}`,
      policyVersion: 'sis-v1.0/action-tiers-adr007',
      executionEvidence: 'executions?agentUri=agent://aion/revenue/pipeline-ops/',
      revocationState: 'active',
      environment: 'staging',
      credentialMethod: 'runtime-principal',
      approvalRequirements: ['R3 human gate'],
    });

    const record = toAgentRegistryRecord(agent);
    expect(record.humanOwner).toBe('operator-alex');
    expect(record.businessPurpose).toContain('CRM');
    expect(record.tenant).toBe('aion-systems');
    expect(record.permissionTier).toBe('assist');
    expect(record.delegatedAuthorityId).toBe(authorityId);
    expect(record.policyVersion).toBe('sis-v1.0/action-tiers-adr007');
    expect(record.revocationState).toBe('active');
    expect(record.environment).toBe('staging');
  });

  it('builds inventory with complete / incomplete / orphan counts', () => {
    const complete = createAgentActor({
      name: 'Complete',
      purpose: 'assist',
      owner: 'ops',
      tenantId: 't1',
      autonomyLevel: 'L0',
      actionTier: 'observe',
      delegatedAuthorityEvidence: 'ops root',
      policyVersion: 'v1',
      executionEvidence: 'audit://t1/agents/complete',
      revocationState: 'active',
    });
    const orphan = createAgentActor({
      name: 'Orphan',
      purpose: 'unknown',
      owner: 'x',
      autonomyLevel: 'L0',
    });
    const inventory = buildAgentRegistryInventory([complete, orphan]);
    expect(inventory.completeCount).toBe(1);
    expect(inventory.incompleteCount).toBe(1);
    expect(inventory.orphanCount).toBe(1);
    expect(inventory.entries[1]!.missing).toContain('tenant');
  });

  it('revokes and blocks execution when not active', () => {
    const agent = createAgentActor({
      name: 'Containable',
      purpose: 'test contain',
      owner: 'ops',
      tenantId: 't1',
      autonomyLevel: 'L1',
      actionTier: 'assist',
      delegatedAuthorityEvidence: 'ops',
      policyVersion: 'v1',
      executionEvidence: 'audit://contain',
      revocationState: 'active',
    });
    expect(isAgentExecutionAllowed(agent)).toBe(true);
    const revoked = withAgentRevocationState(
      agent,
      'revoked',
      '2026-10-06T12:00:00.000Z',
    );
    expect(revoked.revocationState).toBe('revoked');
    expect(isAgentExecutionAllowed(revoked)).toBe(false);
    expect(revoked.metadata.priorRevocationState).toBe('active');
  });

  it('derives permission_tier from autonomy when actionTier omitted', () => {
    const agent = createAgentActor({
      name: 'Derived tier',
      purpose: 'observe via L0',
      owner: 'ops',
      tenantId: 't1',
      autonomyLevel: 'L0',
      delegatedAuthorityEvidence: 'ops',
      policyVersion: 'v1',
      executionEvidence: 'audit://derived',
      revocationState: 'active',
    });
    const record = toAgentRegistryRecord(agent);
    expect(record.permissionTier).toBe('observe');
  });
});
