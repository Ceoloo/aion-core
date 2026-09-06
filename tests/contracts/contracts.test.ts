import { describe, it, expect } from 'vitest';
import {
  Command,
  AionEvent,
  Capability,
  capability,
  createAgentActor,
  createMission,
  createTool,
  createExecutionObject,
  createServiceDefinition,
  buildMission001Catalog,
  formatAgentUri,
  parseAgentUri,
  parseServiceKey,
  ExecutionObject,
  EVENT_TYPES,
  newRequestId,
  newCommandId,
  newRunId,
  newCorrelationId,
  newActorId,
} from '../../src/index.js';

describe('contract validation', () => {
  it('accepts a valid capability and rejects a malformed one', () => {
    expect(() => Capability.parse('research.summary')).not.toThrow();
    expect(() => Capability.parse('Research Summary')).toThrow();
    expect(() => Capability.parse('nodot')).toThrow();
  });

  it('parses a well-formed command and applies defaults', () => {
    const actor = createAgentActor({
      name: 'A',
      purpose: 'p',
      owner: 'o',
      permissions: [capability('research.summary')],
    });
    const cmd = Command.parse({
      commandId: newCommandId(),
      requestId: newRequestId(),
      name: 'ResearchProspect',
      actor,
      capability: capability('research.summary'),
      createdAt: new Date().toISOString(),
    });
    expect(cmd.payload).toEqual({});
    expect(cmd.metadata).toEqual({});
  });

  it('rejects a command missing an actor', () => {
    const result = Command.safeParse({
      commandId: newCommandId(),
      requestId: newRequestId(),
      name: 'X',
      capability: capability('research.summary'),
      createdAt: new Date().toISOString(),
    });
    expect(result.success).toBe(false);
  });

  it('every event type is past-tense and dotted (fact, not command)', () => {
    // No event name uses an imperative verb prefix.
    const imperativePrefixes = ['send.', 'do.', 'create.', 'start.', 'make.'];
    for (const type of EVENT_TYPES) {
      expect(type).toMatch(/^[a-z]+\.[a-z]+/);
      expect(imperativePrefixes.some((p) => type.startsWith(p))).toBe(false);
    }
  });

  it('parses a valid event envelope', () => {
    const evt = AionEvent.parse({
      eventId: 'evt_1',
      eventType: 'policy.allowed',
      timestamp: new Date().toISOString(),
    });
    expect(evt.payload).toEqual({});
  });

  it('builds a mission and a tool via factories', () => {
    const mission = createMission({
      name: 'M',
      owner: 'o',
      objective: 'do a thing',
    });
    expect(mission.missionId).toMatch(/^msn_/);
    expect(mission.status).toBe('active');

    const tool = createTool({
      name: 'summarizer',
      capability: capability('research.summary'),
      riskLevel: 'R1',
    });
    expect(tool.toolId).toMatch(/^tool_/);
  });

  it('mints canonical agent://aion/{domain}/{role}/{id} identity fields', () => {
    const agent = createAgentActor({
      name: 'Pipeline Ops',
      purpose: 'qualify leads',
      owner: 'revenue',
      domain: 'revenue',
      role: 'pipeline-ops',
      permissions: [capability('research.summary')],
      allowedData: ['crm.leads.read'],
      autonomyLevel: 'L2',
      evaluationCriteria: ['revenue.lead.qualify@1'],
      observabilityRequirements: ['telemetry.cost', 'events.lifecycle'],
    });
    expect(agent.agentUri).toBe(
      formatAgentUri({
        domain: 'revenue',
        role: 'pipeline-ops',
        id: agent.agentId,
      }),
    );
    expect(parseAgentUri(agent.agentUri!).domain).toBe('revenue');
    expect(agent.allowedData).toEqual(['crm.leads.read']);
    expect(agent.autonomyLevel).toBe('L2');
  });

  it('builds a canonical Execution Object from a run + agent', () => {
    const agent = createAgentActor({
      name: 'A',
      purpose: 'p',
      owner: 'o',
      domain: 'revenue',
      role: 'copilot',
      tenantId: 'aion-systems',
    });
    const now = new Date().toISOString();
    const run = {
      runId: newRunId(),
      requestId: newRequestId(),
      commandId: newCommandId(),
      actorId: agent.actorId,
      state: 'completed' as const,
      riskLevel: 'R1' as const,
      correlationId: newCorrelationId(),
      createdAt: now,
      updatedAt: now,
    };
    const exe = createExecutionObject({ run, agent });
    expect(exe.executionId).toMatch(/^exe_/);
    expect(exe.agentUri).toBe(agent.agentUri);
    expect(exe.status).toBe('succeeded');
    expect(exe.tenantId).toBe('aion-systems');
    expect(ExecutionObject.parse(exe).auditTrace.length).toBeGreaterThan(0);
    // actorId brand is preserved through the factory.
    expect(exe.actorId).toBe(agent.actorId);
    expect(exe.actorId).not.toBe(newActorId());
  });

  it('seeds Mission 001 Service Catalog v0 with versioned keys', () => {
    const catalog = buildMission001Catalog();
    expect(catalog).toHaveLength(5);
    expect(catalog.map((s) => s.serviceKey)).toEqual([
      'revenue.lead.research@1',
      'revenue.lead.enrich@1',
      'revenue.lead.score@1',
      'revenue.outreach.generate@1',
      'revenue.followup.execute@1',
    ]);
    for (const svc of catalog) {
      expect(svc.capability).toBe(svc.name);
      expect(svc.serviceId).toMatch(/^svc_/);
      expect(svc.status).toBe('active');
    }
    const followup = catalog.find((s) => s.name === 'revenue.followup.execute');
    expect(followup?.approvalRequired).toBe(true);
    expect(followup?.riskLevel).toBe('R2');

    const viaFactory = createServiceDefinition({
      serviceKey: 'revenue.lead.research@1',
      owner: 'aion-systems/revenue',
    });
    expect(viaFactory.capability).toBe('revenue.lead.research');
    expect(parseServiceKey(viaFactory.serviceKey)).toEqual({
      name: 'revenue.lead.research',
      version: 1,
    });
  });
});
