import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  ApprovalGate,
  InMemoryApprovalStore,
  Command,
  capability,
  createAgentActor,
  createHumanActor,
  ManualClock,
  newRequestId,
  newCommandId,
  newRunId,
  newExecutionId,
  newApprovalId,
  AuthorizationRequest,
  type ApprovalRequest,
  type AgentActor,
} from '../../src/index.js';

const clock = new ManualClock();

function agent(overrides: {
  name: string;
  tenantId: string;
  permissions: string[];
  maxRiskLevel?: 'R0' | 'R1' | 'R2' | 'R3';
  costBudget?: number;
}): AgentActor {
  return createAgentActor({
    name: overrides.name,
    purpose: 'mission-003-isolation',
    owner: 'platform',
    permissions: overrides.permissions.map((p) => capability(p)),
    maxRiskLevel: overrides.maxRiskLevel ?? 'R3',
    tenantId: overrides.tenantId,
    domain: 'systems',
    role: 'operator',
    ...(overrides.costBudget !== undefined
      ? { costBudget: overrides.costBudget }
      : {}),
  });
}

function auth(
  actor: AgentActor,
  overrides: Partial<AuthorizationRequest> & {
    action: string;
  },
): AuthorizationRequest {
  return AuthorizationRequest.parse({
    agentId: actor.agentId,
    agentUri: actor.agentUri,
    tenantId: actor.tenantId,
    permissions: actor.permissions.map(String),
    capability: 'revenue.lead.research',
    ...overrides,
  });
}

function grantedApproval(
  actor: AgentActor,
  executionId: string,
  extras: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    approvalId: extras.approvalId ?? newApprovalId(),
    runId: newRunId(),
    requestId: newRequestId(),
    executionId: executionId as ApprovalRequest['executionId'],
    tenantId: actor.tenantId,
    command: Command.parse({
      commandId: newCommandId(),
      requestId: newRequestId(),
      name: 'FollowUp',
      actor,
      capability: capability('revenue.followup.execute'),
      createdAt: clock.isoNow(),
    }),
    riskLevel: 'R2',
    reason: 'gated',
    status: 'granted',
    requestedAt: clock.isoNow(),
    decidedAt: clock.isoNow(),
    decidedBy: createHumanActor({ name: 'Boss' }).actorId,
    ...extras,
  };
}

describe('PolicyEngine.authorize — Mission 003 attack suite', () => {
  const engine = new PolicyEngine(
    {
      risk: {
        capabilityRisk: {
          'revenue.lead.research': 'R1',
          'revenue.followup.execute': 'R2',
          'production.deploy': 'R3',
          'media.trend.research': 'R1',
        },
      },
      gatedCapabilities: [capability('revenue.followup.execute')],
    },
    { clock },
  );

  it('DENY: Tenant A cannot read Tenant B execution', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'read_execution',
        resourceTenantId: 'tenant-b',
        targetExecutionId: newExecutionId(),
      }),
      { actor: a },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'tenant-scope')?.passed).toBe(
      false,
    );
  });

  it('DENY: Tenant A cannot mutate Tenant B artifact', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'mutate_artifact',
        resourceTenantId: 'tenant-b',
        resourceRefs: ['artifact:tenant-b/x'],
      }),
      { actor: a },
    );
    expect(decision.decision).toBe('DENY');
  });

  it('DENY: Tenant A agent cannot invoke unauthorized service', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'invoke',
        capability: 'production.deploy',
        riskLevel: 'R3',
      }),
      { actor: a },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'permission')?.passed).toBe(
      false,
    );
  });

  it('DENY: Media agent cannot production.deploy', () => {
    const media = agent({
      name: 'Media',
      tenantId: 'aion-media',
      permissions: ['media.trend.research'],
    });
    const decision = engine.authorize(
      auth(media, {
        action: 'invoke',
        capability: 'production.deploy',
        riskLevel: 'R3',
      }),
      { actor: media },
    );
    expect(decision.decision).toBe('DENY');
  });

  it('DENY: agent cannot spoof another agentId', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const decision = engine.authorize(
      auth(a, { action: 'invoke', agentId: 'agt_spoofed_other' }),
      { actor: a },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.checks.find((c) => c.kind === 'identity')?.passed).toBe(
      false,
    );
  });

  it('REQUIRE_APPROVAL: R2 execute without approvalId', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.followup.execute'],
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'execute',
        capability: 'revenue.followup.execute',
        riskLevel: 'R2',
      }),
      { actor: a },
    );
    expect(decision.decision).toBe('REQUIRE_APPROVAL');
  });

  it('DENY: approvalId from execution A cannot authorize execution B', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.followup.execute'],
    });
    const exeA = newExecutionId();
    const exeB = newExecutionId();
    const approval = grantedApproval(a, exeA);
    const decision = engine.authorize(
      auth(a, {
        action: 'execute',
        capability: 'revenue.followup.execute',
        riskLevel: 'R2',
        approvalId: approval.approvalId,
        approvalExecutionId: exeA,
        targetExecutionId: exeB,
      }),
      { actor: a, approval },
    );
    expect(decision.decision).toBe('DENY');
    expect(
      decision.checks.find((c) => c.kind === 'approval-binding')?.passed,
    ).toBe(false);
  });

  it('DENY: approvalId replay after consume', async () => {
    const gate = new ApprovalGate(new InMemoryApprovalStore(), clock);
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.followup.execute'],
    });
    const exe = newExecutionId();
    const command = Command.parse({
      commandId: newCommandId(),
      requestId: newRequestId(),
      name: 'FollowUp',
      actor: a,
      capability: capability('revenue.followup.execute'),
      createdAt: clock.isoNow(),
    });
    const pending = await gate.request(
      command,
      newRunId(),
      {
        decision: 'REQUIRE_APPROVAL',
        reason: 'gated',
        policyId: 'test',
        riskLevel: 'R2',
        requiresApproval: true,
        checks: [],
        evaluatedAt: clock.isoNow(),
      },
      { executionId: exe, tenantId: 'tenant-a' },
    );
    const granted = await gate.decide({
      approvalId: pending.approvalId,
      approve: true,
      decidedBy: createHumanActor({ name: 'Boss' }).actorId,
    });
    const consumed = await gate.consume(granted.approvalId);
    expect(consumed.consumedAt).toBeTruthy();

    const decision = engine.authorize(
      auth(a, {
        action: 'execute',
        capability: 'revenue.followup.execute',
        riskLevel: 'R2',
        approvalId: consumed.approvalId,
        targetExecutionId: exe,
        approvalExecutionId: exe,
      }),
      { actor: a, approval: consumed },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toMatch(/consumed|replay/i);
  });

  it('DENY: expired approval', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.followup.execute'],
    });
    const exe = newExecutionId();
    const approval = grantedApproval(a, exe, {
      expiresAt: '2020-01-02T00:00:00.000Z',
      requestedAt: '2020-01-01T00:00:00.000Z',
      decidedAt: '2020-01-01T00:00:00.000Z',
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'execute',
        capability: 'revenue.followup.execute',
        riskLevel: 'R2',
        approvalId: approval.approvalId,
        targetExecutionId: exe,
      }),
      { actor: a, approval, now: '2026-01-01T00:00:00.000Z' },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toMatch(/expired/i);
  });

  it('DENY: serviceKey tampering', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'invoke',
        capability: 'revenue.lead.research',
        serviceKey: 'production.deploy@1',
        riskLevel: 'R1',
      }),
      { actor: a, resolvedServiceKey: 'revenue.lead.research@1' },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toMatch(/serviceKey tampering/i);
  });

  it('DENY: cross-tenant context reference', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'read_context',
        resourceTenantId: 'tenant-b',
        resourceRefs: ['context:tenant-b/secret'],
      }),
      { actor: a },
    );
    expect(decision.decision).toBe('DENY');
  });

  it('DENY: budget exceeded', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
      costBudget: 10,
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'invoke',
        capability: 'revenue.lead.research',
        riskLevel: 'R1',
        estimatedCost: 50,
        budgetRemaining: 10,
      }),
      { actor: a },
    );
    expect(decision.decision).toBe('DENY');
    expect(decision.reason).toMatch(/budget/i);
  });

  it('ALLOW: valid shared capability', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'invoke',
        capability: 'revenue.lead.research',
        serviceKey: 'revenue.lead.research@1',
        riskLevel: 'R1',
      }),
      { actor: a, resolvedServiceKey: 'revenue.lead.research@1' },
    );
    expect(decision.decision).toBe('ALLOW');
  });

  it('ALLOW: same service from two tenants (isolated records)', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.lead.research'],
    });
    const b = agent({
      name: 'B',
      tenantId: 'tenant-b',
      permissions: ['revenue.lead.research'],
    });
    expect(
      engine.authorize(
        auth(a, {
          action: 'invoke',
          capability: 'revenue.lead.research',
          riskLevel: 'R1',
        }),
        { actor: a },
      ).decision,
    ).toBe('ALLOW');
    expect(
      engine.authorize(
        auth(b, {
          action: 'invoke',
          capability: 'revenue.lead.research',
          riskLevel: 'R1',
        }),
        { actor: b },
      ).decision,
    ).toBe('ALLOW');
    expect(a.tenantId).not.toBe(b.tenantId);
  });

  it('ALLOW: bound granted approval for matching execution', () => {
    const a = agent({
      name: 'A',
      tenantId: 'tenant-a',
      permissions: ['revenue.followup.execute'],
    });
    const exe = newExecutionId();
    const approval = grantedApproval(a, exe, {
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const decision = engine.authorize(
      auth(a, {
        action: 'execute',
        capability: 'revenue.followup.execute',
        riskLevel: 'R2',
        approvalId: approval.approvalId,
        targetExecutionId: exe,
        approvalExecutionId: exe,
      }),
      { actor: a, approval },
    );
    expect(decision.decision).toBe('ALLOW');
  });
});
