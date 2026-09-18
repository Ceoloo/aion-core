import { describe, it, expect } from 'vitest';
import {
  createRootAuthority,
  attenuateAuthority,
  authoritySubsumes,
  authorityIsActive,
  authorityGrantsCapability,
  authorityAllowsRisk,
  effectiveRiskCeiling,
  DelegatedAuthority,
  capability,
  newToolId,
  type Principal,
  type ToolId,
} from '../../src/index.js';

const human: Principal = { kind: 'human', ref: 'act_ceo' };
const orchestrator: Principal = {
  kind: 'orchestrator',
  ref: 'agent://aion/revenue/orchestrator/agt_1',
};
const worker: Principal = {
  kind: 'sub-agent',
  ref: 'agent://aion/revenue/pipeline-ops/agt_2',
};

const CRM_READ = capability('crm.read');
const CRM_WRITE = capability('crm.write');
const RESEARCH = capability('research.web');

function root(
  overrides: Partial<Parameters<typeof createRootAuthority>[0]> = {},
) {
  return createRootAuthority({
    subject: human,
    tenantId: 'tenant-a',
    grantReason: 'ceo root grant',
    capabilities: [CRM_READ, CRM_WRITE, RESEARCH],
    maxRiskLevel: 'R3',
    maxAutonomyLevel: 'L4',
    budget: 1000,
    ...overrides,
  });
}

describe('createRootAuthority', () => {
  it('creates a top-of-tree grant with a single-principal chain', () => {
    const a = root();
    expect(a.authorityId).toMatch(/^auth_/);
    expect(a.parentAuthorityId).toBeUndefined();
    expect(a.principalChain).toEqual([human]);
    expect(DelegatedAuthority.parse(a)).toEqual(a);
  });
});

describe('attenuateAuthority — delegation can only narrow', () => {
  it('produces a child that its parent subsumes', () => {
    const parent = root();
    const child = attenuateAuthority(parent, {
      subject: orchestrator,
      grantReason: 'delegate read-only research to orchestrator',
      capabilities: [CRM_READ, RESEARCH],
      maxRiskLevel: 'R2',
      budget: 400,
    });
    expect(child.parentAuthorityId).toBe(parent.authorityId);
    expect(child.principalChain).toEqual([human, orchestrator]);
    expect(authoritySubsumes(parent, child).ok).toBe(true);
    expect(child.capabilities.map(String).sort()).toEqual(['crm.read', 'research.web']);
    expect(child.maxRiskLevel).toBe('R2');
    expect(child.budget).toBe(400);
  });

  it('cannot amplify: requested capabilities are intersected with the parent', () => {
    // Parent that only holds crm.read.
    const parent = root({ capabilities: [CRM_READ] });
    const child = attenuateAuthority(parent, {
      subject: orchestrator,
      grantReason: 'attempt to self-grant crm.write',
      capabilities: [CRM_READ, CRM_WRITE], // asks for more than parent has
    });
    // crm.write is dropped — amplification is unrepresentable.
    expect(child.capabilities.map(String)).toEqual(['crm.read']);
    expect(authorityGrantsCapability(child, CRM_WRITE)).toBe(false);
    expect(authoritySubsumes(parent, child).ok).toBe(true);
  });

  it('clamps a higher requested risk ceiling down to the parent', () => {
    const parent = root({ maxRiskLevel: 'R1' });
    const child = attenuateAuthority(parent, {
      subject: orchestrator,
      grantReason: 'attempt to raise risk',
      maxRiskLevel: 'R3',
    });
    expect(child.maxRiskLevel).toBe('R1');
  });

  it('caps the child lifetime at the parent expiry', () => {
    const parent = root({ expiresAt: '2026-01-01T00:00:00.000Z' });
    const child = attenuateAuthority(parent, {
      subject: orchestrator,
      grantReason: 'attempt to outlive parent',
      expiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(child.expiresAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('bounds an unbounded child budget by the parent budget', () => {
    const parent = root({ budget: 100 });
    const child = attenuateAuthority(parent, {
      subject: orchestrator,
      grantReason: 'no budget requested',
    });
    expect(child.budget).toBe(100);
  });
});

describe('authoritySubsumes — detects every amplification', () => {
  const parent = root({
    capabilities: [CRM_READ],
    tools: [],
    dataScopes: ['crm.contacts'],
    maxRiskLevel: 'R2',
    maxAutonomyLevel: 'L2',
    budget: 100,
  });

  function tampered(patch: Partial<DelegatedAuthority>): DelegatedAuthority {
    return DelegatedAuthority.parse({ ...parent, authorityId: 'auth_child', parentAuthorityId: parent.authorityId, ...patch });
  }

  it('flags capability escalation', () => {
    const r = authoritySubsumes(parent, tampered({ capabilities: [CRM_READ, CRM_WRITE] }));
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('capability escalation');
  });

  it('flags tool escalation', () => {
    const tool = newToolId();
    const r = authoritySubsumes(parent, tampered({ tools: [tool] as ToolId[] }));
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('tool escalation');
  });

  it('flags data-scope escalation', () => {
    const r = authoritySubsumes(parent, tampered({ dataScopes: ['crm.contacts', 'billing.cards'] }));
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('data-scope escalation');
  });

  it('flags risk, autonomy, and budget escalation', () => {
    const r = authoritySubsumes(
      parent,
      tampered({ maxRiskLevel: 'R3', maxAutonomyLevel: 'L4', budget: 500 }),
    );
    expect(r.ok).toBe(false);
    const joined = r.violations.join(' ');
    expect(joined).toContain('risk escalation');
    expect(joined).toContain('autonomy escalation');
    expect(joined).toContain('budget escalation');
  });

  it('flags a tenant crossing', () => {
    const r = authoritySubsumes(parent, tampered({ tenantId: 'tenant-b' }));
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('tenant escalation');
  });

  it('flags a company-scope escape', () => {
    const scoped = root({ companyId: 'co-1', capabilities: [CRM_READ] });
    const child = DelegatedAuthority.parse({
      ...scoped,
      authorityId: 'auth_child',
      companyId: 'co-2',
    });
    const r = authoritySubsumes(scoped, child);
    expect(r.ok).toBe(false);
    expect(r.violations.join(' ')).toContain('company scope escape');
  });
});

describe('authority helpers', () => {
  it('authorityIsActive respects status and expiry', () => {
    const a = root({ expiresAt: '2026-06-01T00:00:00.000Z' });
    expect(authorityIsActive(a, '2026-05-01T00:00:00.000Z')).toBe(true);
    expect(authorityIsActive(a, '2026-07-01T00:00:00.000Z')).toBe(false);
    const revoked = DelegatedAuthority.parse({ ...a, status: 'revoked' });
    expect(authorityIsActive(revoked, '2026-05-01T00:00:00.000Z')).toBe(false);
  });

  it('authorityAllowsRisk honours the ceiling', () => {
    const a = root({ maxRiskLevel: 'R2' });
    expect(authorityAllowsRisk(a, 'R2')).toBe(true);
    expect(authorityAllowsRisk(a, 'R3')).toBe(false);
  });

  it('effectiveRiskCeiling takes the most restrictive link in a chain', () => {
    const a = root({ maxRiskLevel: 'R3' });
    const b = attenuateAuthority(a, {
      subject: orchestrator,
      grantReason: 'narrow to R1',
      maxRiskLevel: 'R1',
    });
    const c = attenuateAuthority(b, {
      subject: worker,
      grantReason: 'inherit',
    });
    expect(effectiveRiskCeiling([a, b, c])).toBe('R1');
  });
});
