import { describe, it, expect } from 'vitest';
import {
  createInMemoryControlPlane,
  createAgentActor,
  createHumanActor,
  createMission,
  createWorkflow,
  MockExecutionAdapter,
  ManualClock,
  capability,
} from '../../src/index.js';

const RESEARCH = capability('revenue.lead.research');
const ENRICH = capability('revenue.lead.enrich');
const FOLLOWUP = capability('revenue.followup.execute');
const GHL_UPSERT = capability('client.ghl.contact.upsert');

describe('MissionOrchestrator (Mission 004)', () => {
  it('runs a multi-step client-money workflow under one root lineage tree', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: {
        risk: {
          capabilityRisk: {
            'revenue.lead.research': 'R1',
            'revenue.lead.enrich': 'R1',
            'client.ghl.contact.upsert': 'R1',
          },
        },
      },
      adapters: [
        new MockExecutionAdapter({
          name: 'm004-mock',
          capabilities: [RESEARCH, ENRICH, GHL_UPSERT],
          output: { stub: true },
        }),
      ],
    });

    const agent = createAgentActor({
      name: 'RevenueCopilot',
      purpose: 'client money path',
      owner: 'revenue',
      tenantId: 'tenant-a',
      permissions: [RESEARCH, ENRICH, GHL_UPSERT],
      maxRiskLevel: 'R2',
    });

    const mission = createMission({
      name: 'Client GHL loop',
      owner: 'revenue',
      objective: 'Research → enrich → upsert GHL contact',
    });
    await plane.missionRepository.save(mission);

    const workflow = createWorkflow({
      name: 'client-money-ghl-v0',
      description: 'Mission 004 client money path (mock GHL)',
      steps: [
        { name: 'research', capability: RESEARCH, riskLevel: 'R1' },
        { name: 'enrich', capability: ENRICH, riskLevel: 'R1' },
        {
          name: 'ghl-upsert',
          capability: GHL_UPSERT,
          riskLevel: 'R1',
          description: 'Mock GoHighLevel contact upsert',
        },
      ],
    });
    await plane.workflowRepository.save(workflow);

    const result = await plane.missionOrchestrator.run({
      missionId: mission.missionId,
      workflowId: workflow.workflowId,
      actor: agent,
      requestIdPrefix: 'm004-proof-a',
      stepPayloads: {
        'ghl-upsert': {
          provider: 'ghl',
          contact: { email: 'lead@example.com', source: 'aion-m004' },
        },
      },
    });

    expect(result.status).toBe('completed');
    expect(result.steps).toHaveLength(3);
    expect(result.rootExecutionId).toBeTruthy();

    // Root step has no parent; children share the same root.
    expect(result.steps[0]!.parentExecutionId).toBeUndefined();
    expect(result.steps[0]!.executionId).toBe(result.rootExecutionId);
    expect(result.steps[1]!.parentExecutionId).toBe(result.steps[0]!.executionId);
    expect(result.steps[1]!.rootExecutionId).toBe(result.rootExecutionId);
    expect(result.steps[2]!.parentExecutionId).toBe(result.steps[1]!.executionId);
    expect(result.steps[2]!.rootExecutionId).toBe(result.rootExecutionId);

    // Each step completed independently through the single-command orchestrator.
    for (const step of result.steps) {
      expect(step.status).toBe('completed');
      expect(step.orchestration.run.missionId).toBe(mission.missionId);
      expect(step.orchestration.run.workflowId).toBe(workflow.workflowId);
    }
  });

  it('pauses on a gated R2 step and resumes the remaining tree under the same root', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: {
        risk: {
          capabilityRisk: {
            'revenue.lead.research': 'R1',
            'revenue.followup.execute': 'R2',
            'client.ghl.contact.upsert': 'R1',
          },
        },
        // R2 followup requires approval
        gatedCapabilities: [FOLLOWUP],
      },
      adapters: [
        new MockExecutionAdapter({
          name: 'm004-gated-mock',
          capabilities: [RESEARCH, FOLLOWUP, GHL_UPSERT],
          output: { stub: true },
        }),
      ],
    });

    const agent = createAgentActor({
      name: 'RevenueCopilot',
      purpose: 'gated client path',
      owner: 'revenue',
      tenantId: 'tenant-a',
      permissions: [RESEARCH, FOLLOWUP, GHL_UPSERT],
      maxRiskLevel: 'R3',
    });

    const mission = createMission({
      name: 'Gated GHL loop',
      owner: 'revenue',
      objective: 'Research → gated followup → GHL upsert',
    });
    await plane.missionRepository.save(mission);

    const workflow = createWorkflow({
      name: 'client-money-gated-v0',
      steps: [
        { name: 'research', capability: RESEARCH, riskLevel: 'R1' },
        { name: 'followup', capability: FOLLOWUP, riskLevel: 'R2' },
        { name: 'ghl-upsert', capability: GHL_UPSERT, riskLevel: 'R1' },
      ],
    });
    await plane.workflowRepository.save(workflow);

    const paused = await plane.missionOrchestrator.run({
      missionId: mission.missionId,
      workflowId: workflow.workflowId,
      actor: agent,
      requestIdPrefix: 'm004-proof-c',
    });

    expect(paused.status).toBe('awaiting_approval');
    expect(paused.stoppedAtStep).toBe(1);
    expect(paused.steps).toHaveLength(2);
    expect(paused.steps[1]!.status).toBe('awaiting_approval');
    const rootExecutionId = paused.rootExecutionId;
    const gatedExecutionId = paused.steps[1]!.executionId;
    const approvalId = paused.steps[1]!.orchestration.approval!.approvalId;

    const approver = createHumanActor({
      name: 'RevenueLead',
      permissions: [FOLLOWUP],
      maxRiskLevel: 'R3',
    });
    const resumedStep = await plane.orchestrator.resume({
      approvalId,
      approve: true,
      decidedBy: approver.actorId,
    });
    expect(resumedStep.status).toBe('completed');

    const continued = await plane.missionOrchestrator.run({
      missionId: mission.missionId,
      workflowId: workflow.workflowId,
      actor: agent,
      resumeFromStep: 2,
      rootExecutionId,
      parentExecutionId: gatedExecutionId,
      requestIdPrefix: 'm004-proof-c-resume',
    });

    expect(continued.status).toBe('completed');
    expect(continued.rootExecutionId).toBe(rootExecutionId);
    expect(continued.steps).toHaveLength(1);
    expect(continued.steps[0]!.parentExecutionId).toBe(gatedExecutionId);
    expect(continued.steps[0]!.rootExecutionId).toBe(rootExecutionId);
  });

  it('denies mid-plan without executing later steps', async () => {
    const plane = createInMemoryControlPlane({
      clock: new ManualClock(),
      policy: {
        risk: {
          capabilityRisk: {
            'revenue.lead.research': 'R1',
            'revenue.followup.execute': 'R2',
          },
        },
      },
      adapters: [
        new MockExecutionAdapter({
          name: 'm004-deny-mock',
          capabilities: [RESEARCH, FOLLOWUP],
          output: { stub: true },
        }),
      ],
    });

    // Agent lacks FOLLOWUP permission → DENY on step 2
    const agent = createAgentActor({
      name: 'LimitedAgent',
      purpose: 'limited',
      owner: 'revenue',
      tenantId: 'tenant-a',
      permissions: [RESEARCH],
      maxRiskLevel: 'R2',
    });

    const mission = createMission({
      name: 'Deny mid-plan',
      owner: 'revenue',
      objective: 'prove stop-on-deny',
    });
    await plane.missionRepository.save(mission);

    const workflow = createWorkflow({
      name: 'deny-mid',
      steps: [
        { name: 'research', capability: RESEARCH, riskLevel: 'R1' },
        { name: 'followup', capability: FOLLOWUP, riskLevel: 'R2' },
      ],
    });
    await plane.workflowRepository.save(workflow);

    const result = await plane.missionOrchestrator.run({
      missionId: mission.missionId,
      workflowId: workflow.workflowId,
      actor: agent,
    });

    expect(result.status).toBe('denied');
    expect(result.stoppedAtStep).toBe(1);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]!.status).toBe('completed');
    expect(result.steps[1]!.status).toBe('denied');
  });
});
