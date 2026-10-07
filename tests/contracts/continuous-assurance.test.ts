import { describe, it, expect } from 'vitest';
import {
  ASSURANCE_CHECK_CATALOG,
  ASSURANCE_CHECK_IDS,
  PROTOTYPE_ASSURANCE_CHECK_IDS,
  createAgentActor,
  createExecutionObject,
  createRootAuthority,
  capability,
  newToolId,
  newRunId,
  newRequestId,
  newCommandId,
  newCorrelationId,
  runAssuranceChecks,
  evaluateCaAg01,
  evaluateCaAg02,
  evaluateCaAg03,
  evaluateCaAg04,
  evaluateCaRt01,
  evaluateCaRv02,
  type AgentActor,
  type ExecutionObject,
} from '../../src/index.js';

const NOW = '2026-10-07T12:00:00.000Z';
const TENANT = 'aion-internal';
const crmTool = newToolId();

function completeExecuteAgent(overrides: Partial<AgentActor> = {}): AgentActor {
  const authority = createRootAuthority({
    subject: { kind: 'human', ref: 'dana@aion.systems' },
    tenantId: TENANT,
    grantReason: 'assurance fixture',
    capabilities: [capability('crm.write')],
    tools: [crmTool],
    dataScopes: ['crm.contacts'],
    maxRiskLevel: 'R2',
    maxAutonomyLevel: 'L2',
    createdAt: NOW,
  });
  return {
    ...createAgentActor({
      name: 'ExecuteAgent',
      purpose: 'Governed execute-tier CRM writes',
      owner: 'dana@aion.systems',
      domain: 'revenue',
      role: 'executor',
      tenantId: TENANT,
      actionTier: 'execute',
      permissions: [capability('crm.write')],
      allowedTools: [crmTool],
      allowedData: ['crm.contacts'],
      policyVersion: 'sis-v1.0/policy-2026-10-05',
      executionEvidence: 'executions?actor_id={actor_id}',
      revocationState: 'active',
      environment: 'production',
      credentialMethod: 'vaulted-short-lived',
      approvalRequirements: ['R3 human gate'],
    }),
    delegatedAuthority: authority,
    ...overrides,
  };
}

function executionFor(
  agent: AgentActor,
  status: ExecutionObject['status'] = 'succeeded',
): ExecutionObject {
  const run = {
    runId: newRunId(),
    requestId: newRequestId(),
    commandId: newCommandId(),
    actorId: agent.actorId,
    state: status === 'denied' ? ('denied' as const) : ('completed' as const),
    riskLevel: 'R1' as const,
    correlationId: newCorrelationId(),
    createdAt: NOW,
    updatedAt: NOW,
  };
  const exe = createExecutionObject({ run, agent });
  return { ...exe, status };
}

describe('Continuous Assurance (AIO-47)', () => {
  it('catalog covers every ASSURANCE_CHECK_ID with prototype flags', () => {
    expect(ASSURANCE_CHECK_CATALOG).toHaveLength(ASSURANCE_CHECK_IDS.length);
    const prototype = ASSURANCE_CHECK_CATALOG.filter((c) => c.prototype).map(
      (c) => c.checkId,
    );
    expect(prototype).toEqual([...PROTOTYPE_ASSURANCE_CHECK_IDS]);
  });

  it('CA-AG-01 fails incomplete Execute-tier agents', () => {
    const incomplete = createAgentActor({
      name: 'LegacyExecute',
      purpose: 'missing SIS-AG-02',
      owner: 'ops',
      tenantId: TENANT,
      actionTier: 'execute',
    });
    const fail = evaluateCaAg01(TENANT, [incomplete], NOW);
    expect(fail.status).toBe('fail');
    expect(fail.severity).toBe('critical');
    expect(fail.recommendedAction?.requiresApproval).toBe(true);

    const pass = evaluateCaAg01(TENANT, [completeExecuteAgent()], NOW);
    expect(pass.status).toBe('pass');
  });

  it('CA-AG-02 fails unknown observed agents (SIS-AG-10)', () => {
    const agent = completeExecuteAgent();
    const fail = evaluateCaAg02(
      TENANT,
      [agent],
      [agent.agentUri!, 'agent://aion/revenue/shadow/unknown'],
      NOW,
    );
    expect(fail.status).toBe('fail');
    expect(fail.summary).toMatch(/not in registry/);

    const pass = evaluateCaAg02(TENANT, [agent], [agent.agentUri!], NOW);
    expect(pass.status).toBe('pass');
  });

  it('CA-AG-03 flags Assist/Execute grant drift', () => {
    const drifted = completeExecuteAgent({
      allowedTools: [],
      policyVersion: undefined,
    });
    const fail = evaluateCaAg03(TENANT, [drifted], NOW);
    expect(fail.status).toBe('fail');
    expect(fail.severity).toBe('high');

    const pass = evaluateCaAg03(TENANT, [completeExecuteAgent()], NOW);
    expect(pass.status).toBe('pass');
  });

  it('CA-AG-04 detects deny-rate spikes', () => {
    expect(evaluateCaAg04(TENANT, NOW, 0, 10).status).toBe('pass');
    const spike = evaluateCaAg04(TENANT, NOW, 6, 10);
    expect(spike.status).toBe('fail');
    expect(spike.severity).toBe('medium');
  });

  it('CA-RT-01 requires healthy runtime + kill switch', () => {
    expect(evaluateCaRt01(TENANT, NOW, true, true).status).toBe('pass');
    expect(evaluateCaRt01(TENANT, NOW, false, true).status).toBe('fail');
    expect(evaluateCaRt01(TENANT, NOW, true, false).status).toBe('fail');
  });

  it('CA-RV-02 fails when suspended/revoked agents still execute', () => {
    const revoked = completeExecuteAgent({ revocationState: 'revoked' });
    const fail = evaluateCaRv02(
      TENANT,
      [revoked],
      [executionFor(revoked, 'succeeded')],
      NOW,
    );
    expect(fail.status).toBe('fail');
    expect(fail.severity).toBe('critical');

    const deniedOnly = evaluateCaRv02(
      TENANT,
      [revoked],
      [executionFor(revoked, 'denied')],
      NOW,
    );
    expect(deniedOnly.status).toBe('pass');
  });

  it('runAssuranceChecks evaluates prototype checks and stubs the rest', () => {
    const agent = completeExecuteAgent();
    const result = runAssuranceChecks({
      tenantId: TENANT,
      registered: [agent],
      observedAgentIds: [agent.agentUri!],
      recentExecutions: [],
      runtimeHealthy: true,
      killSwitchAvailable: true,
      recentDenyCount: 0,
      recentExecutionCount: 8,
      now: NOW,
    });
    expect(result.prototypeCheckCount).toBe(PROTOTYPE_ASSURANCE_CHECK_IDS.length);
    expect(result.passCount).toBeGreaterThanOrEqual(6);
    expect(result.failCount).toBe(0);
    expect(result.unknownCount).toBe(
      ASSURANCE_CHECK_IDS.length - PROTOTYPE_ASSURANCE_CHECK_IDS.length,
    );
    for (const id of PROTOTYPE_ASSURANCE_CHECK_IDS) {
      const ev = result.evidence.find((e) => e.checkId === id);
      expect(ev?.status).toBe('pass');
      expect(ev?.evidenceId).toMatch(/^cae_/);
    }
  });

  it('runAssuranceChecks can scope to requested checkIds', () => {
    const result = runAssuranceChecks({
      tenantId: TENANT,
      registered: [],
      checkIds: ['CA-AG-02', 'CA-EXP-01'],
      observedAgentIds: ['agent://orphan'],
      now: NOW,
    });
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]!.checkId).toBe('CA-AG-02');
    expect(result.evidence[0]!.status).toBe('fail');
    expect(result.evidence[1]!.checkId).toBe('CA-EXP-01');
    expect(result.evidence[1]!.status).toBe('unknown');
  });
});
