import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  AuthorizationRequest,
  capability,
  createAgentActor,
  createRootAuthority,
  attenuateAuthority,
  createProvenance,
  DelegatedAuthority,
  ManualClock,
  type AgentActor,
  type Principal,
  type DelegatedAuthority as DelegatedAuthorityType,
} from '../../src/index.js';

const clock = new ManualClock();
const NOW = clock.isoNow();

const CRM_READ = capability('crm.read');
const CRM_WRITE = capability('crm.write');

const orchestratorP: Principal = {
  kind: 'orchestrator',
  ref: 'agent://aion/revenue/orchestrator/agt_orc',
};

function agent(permissions: string[]): AgentActor {
  return createAgentActor({
    name: 'pipeline-ops',
    purpose: 'authority-delegation-test',
    owner: 'platform',
    permissions: permissions.map((p) => capability(p)),
    maxRiskLevel: 'R3',
    tenantId: 'tenant-a',
    domain: 'revenue',
    role: 'pipeline-ops',
  });
}

/** The canonical principal for an authenticated agent actor. */
function principalFor(actor: AgentActor): Principal {
  return { kind: 'sub-agent', ref: actor.agentUri! };
}

function auth(
  actor: AgentActor,
  overrides: Partial<AuthorizationRequest> & { action: string },
): AuthorizationRequest {
  return AuthorizationRequest.parse({
    agentId: actor.agentId,
    agentUri: actor.agentUri,
    tenantId: actor.tenantId,
    capability: 'crm.read',
    ...overrides,
  });
}

/** A root authority whose subject is the given actor, unless overridden. */
function rootAuthorityFor(
  actor: AgentActor,
  overrides: Partial<Parameters<typeof createRootAuthority>[0]> = {},
): DelegatedAuthorityType {
  return createRootAuthority({
    subject: principalFor(actor),
    tenantId: 'tenant-a',
    grantReason: 'operator delegated authority',
    capabilities: [CRM_READ, CRM_WRITE],
    maxRiskLevel: 'R2',
    ...overrides,
  });
}

describe('PolicyEngine.authorize — delegated authority', () => {
  const engine = new PolicyEngine();

  it('ALLOWs when the capability is within the delegated authority', () => {
    const actor = agent(['crm.read']);
    const authority = rootAuthorityFor(actor, { capabilities: [CRM_READ] });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('ALLOW');
    expect(
      decision.checks.find((c) => c.kind === 'authority-delegation')?.passed,
    ).toBe(true);
  });

  it('DENYs a capability the actor statically holds but was NOT delegated', () => {
    // The actor is *configured* with crm.write, but the authority handed down
    // for this execution only covers crm.read. Effective power < static grant.
    const actor = agent(['crm.read', 'crm.write']);
    const authority = rootAuthorityFor(actor, { capabilities: [CRM_READ] });
    const decision = engine.authorize(
      auth(actor, { action: 'write', capability: 'crm.write' }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    const check = decision.checks.find((c) => c.kind === 'authority-delegation');
    expect(check?.passed).toBe(false);
    expect(check?.detail).toContain('not within delegated authority');
  });

  it('DENYs an authority issued to a different subject than the actor', () => {
    const actor = agent(['crm.read']);
    // Authority correctly scoped/capable, but issued to someone else.
    const authority = createRootAuthority({
      subject: orchestratorP,
      tenantId: 'tenant-a',
      grantReason: 'issued to the orchestrator, not this worker',
      capabilities: [CRM_READ],
      maxRiskLevel: 'R2',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('not the authenticated actor');
  });

  it('DENYs a data class outside the delegated authority even if statically allowed', () => {
    const actor = agent(['crm.read']);
    // Static actor allows the data class, but the delegated authority does not.
    actor.allowedData.push('billing.cards');
    const authority = rootAuthorityFor(actor, {
      capabilities: [CRM_READ],
      dataScopes: ['crm.contacts'],
    });
    const decision = engine.authorize(
      auth(actor, {
        action: 'read',
        capability: 'crm.read',
        resourceDataClasses: ['billing.cards'],
      }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('not within delegated authority');
  });

  it('DENYs a company-scoped authority when the request names no company', () => {
    const actor = agent(['crm.read']);
    const authority = rootAuthorityFor(actor, {
      capabilities: [CRM_READ],
      companyId: 'co-1',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('!= request company');
  });

  it('DENYs an estimated cost above the delegated authority budget', () => {
    const actor = agent(['crm.read']);
    const authority = rootAuthorityFor(actor, {
      capabilities: [CRM_READ],
      budget: 1,
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read', estimatedCost: 50 }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('exceeds delegated authority budget');
  });

  it('DENYs when the action risk exceeds the delegated authority ceiling', () => {
    const actor = agent(['crm.read']);
    const authority = rootAuthorityFor(actor, {
      capabilities: [CRM_READ],
      maxRiskLevel: 'R1',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read', riskLevel: 'R2' }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('exceeds delegated authority ceiling');
  });

  it('enforces authority(child) ⊆ authority(parent): allows a properly attenuated child', () => {
    const actor = agent(['crm.read']);
    const parent = createRootAuthority({
      subject: orchestratorP,
      tenantId: 'tenant-a',
      grantReason: 'operator → orchestrator',
      capabilities: [CRM_READ, CRM_WRITE],
      maxRiskLevel: 'R2',
    });
    const child = attenuateAuthority(parent, {
      subject: principalFor(actor),
      grantReason: 'orchestrator delegates read-only to worker',
      capabilities: [CRM_READ],
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authority: child, parentAuthority: parent, now: NOW },
    );
    expect(decision.decision).toBe('ALLOW');
  });

  it('DENYs a child that declares a parent when no parentAuthority is supplied', () => {
    const actor = agent(['crm.read']);
    const parent = createRootAuthority({
      subject: orchestratorP,
      tenantId: 'tenant-a',
      grantReason: 'operator → orchestrator',
      capabilities: [CRM_READ],
      maxRiskLevel: 'R2',
    });
    const child = attenuateAuthority(parent, {
      subject: principalFor(actor),
      grantReason: 'delegate',
      capabilities: [CRM_READ],
    });
    // Child declares a parent, but the caller omits parentAuthority — must not
    // silently bypass the delegation chain.
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authority: child, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('no parentAuthority was supplied');
  });

  it('DENYs an amplified child that claims more than its parent', () => {
    const actor = agent(['crm.read', 'crm.write']);
    const parent = createRootAuthority({
      subject: orchestratorP,
      tenantId: 'tenant-a',
      grantReason: 'operator → orchestrator',
      capabilities: [CRM_READ],
      maxRiskLevel: 'R2',
    });
    // A tampered child authority that grants crm.write its parent never had.
    const child = DelegatedAuthority.parse({
      ...parent,
      authorityId: 'auth_tampered_child',
      parentAuthorityId: parent.authorityId,
      subject: principalFor(actor),
      principalChain: [orchestratorP, principalFor(actor)],
      capabilities: ['crm.read', 'crm.write'],
    });
    const decision = engine.authorize(
      auth(actor, { action: 'write', capability: 'crm.write' }),
      { actor, authority: child, parentAuthority: parent, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('authority amplification');
  });

  it('requires the supplied provenance to match the authority provenanceId', () => {
    const actor = agent(['crm.read']);
    const provenance = createProvenance({
      subject: 'authority',
      origin: 'operator',
      trustLevel: 'trusted',
    });
    const authority = rootAuthorityFor(actor, {
      capabilities: [CRM_READ],
      provenanceId: provenance.provenanceId,
    });
    // Supply a DIFFERENT provenance record than the authority declares.
    const other = createProvenance({
      subject: 'authority',
      origin: 'operator',
      trustLevel: 'trusted',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authority, authorityProvenance: other, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('authority provenance');
  });

  it('DENYs when the delegated authority has expired', () => {
    const actor = agent(['crm.read']);
    const authority = rootAuthorityFor(actor, {
      capabilities: [CRM_READ],
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authority, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('not active');
  });

  it('is backward compatible: no authority in context ⇒ static grant governs', () => {
    const actor = agent(['crm.read']);
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, now: NOW },
    );
    expect(decision.decision).toBe('ALLOW');
    expect(
      decision.checks.some((c) => c.kind === 'authority-delegation'),
    ).toBe(false);
  });
});

describe('PolicyEngine.authorize — provenance', () => {
  const engine = new PolicyEngine();

  it('DENYs when the authority provenance is quarantined', () => {
    const actor = agent(['crm.read']);
    const provenance = createProvenance({
      subject: 'authority',
      origin: 'external',
      trustLevel: 'quarantined',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authorityProvenance: provenance, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('quarantined');
  });

  it('DENYs an untrusted origin backing a consequential (R2) action', () => {
    const actor = agent(['crm.read']);
    const provenance = createProvenance({
      subject: 'authority',
      origin: 'external',
      trustLevel: 'untrusted',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read', riskLevel: 'R2' }),
      { actor, authorityProvenance: provenance, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    const check = decision.checks.find((c) => c.kind === 'provenance');
    expect(check?.passed).toBe(false);
  });

  it('ALLOWs an untrusted origin for low-risk (R1) work', () => {
    const actor = agent(['crm.read']);
    const provenance = createProvenance({
      subject: 'authority',
      origin: 'external',
      trustLevel: 'untrusted',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read', riskLevel: 'R1' }),
      { actor, authorityProvenance: provenance, now: NOW },
    );
    expect(decision.decision).toBe('ALLOW');
    expect(
      decision.checks.find((c) => c.kind === 'provenance')?.passed,
    ).toBe(true);
  });

  it('DENYs an instruction that is not activated (instructionAllowed=false)', () => {
    const actor = agent(['crm.read']);
    // Trusted, but the default instructionAllowed:false keeps it inert.
    const provenance = createProvenance({
      subject: 'instruction',
      origin: 'operator',
      trustLevel: 'trusted',
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authorityProvenance: provenance, now: NOW },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toContain('not activated');
  });

  it('ALLOWs an activated instruction from a principal origin', () => {
    const actor = agent(['crm.read']);
    const provenance = createProvenance({
      subject: 'instruction',
      origin: 'operator',
      trustLevel: 'declared',
      instructionAllowed: true,
    });
    const decision = engine.authorize(
      auth(actor, { action: 'read', capability: 'crm.read' }),
      { actor, authorityProvenance: provenance, now: NOW },
    );
    expect(decision.decision).toBe('ALLOW');
    expect(
      decision.checks.find((c) => c.kind === 'provenance')?.passed,
    ).toBe(true);
  });
});
