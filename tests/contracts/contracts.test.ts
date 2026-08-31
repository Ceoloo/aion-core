import { describe, it, expect } from 'vitest';
import {
  Command,
  AionEvent,
  Capability,
  capability,
  createAgentActor,
  createMission,
  createTool,
  EVENT_TYPES,
  newRequestId,
  newCommandId,
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
});
