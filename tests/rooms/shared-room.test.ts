import { describe, it, expect } from 'vitest';
import {
  SharedRoom,
  ManualClock,
  PermissionDeniedError,
  ValidationError,
  InvalidStateTransitionError,
  NotFoundError,
  createAgentActor,
  createAgentHandoff,
  createHumanActor,
  newAgentId,
  newRoomId,
  type AgentHandoff,
} from '../../src/index.js';

function human(name = 'Ada') {
  return createHumanActor({ name });
}

function agent(tenantId: string, name = 'Scout') {
  return createAgentActor({
    name,
    purpose: 'watch the room',
    owner: 'Ada',
    domain: 'revenue',
    role: 'scout',
    tenantId,
    permissions: [],
  });
}

function handoff(from: ReturnType<typeof agent>, to?: ReturnType<typeof agent>): AgentHandoff {
  return createAgentHandoff({
    kind: 'delegation',
    need: 'check whether we have seen this error',
    confidence: 0.9,
    fromAgentId: from.agentId,
    ...(to ? { toAgentId: to.agentId, toLabel: to.name } : {}),
    facts: [{ statement: 'PASTED_TRANSCRIPT is not a room field' }],
  });
}

describe('SharedRoom', () => {
  it('puts a human and an agent on one timeline, each as themselves', () => {
    const rooms = new SharedRoom(new ManualClock());
    const ada = human();
    const scout = agent('tenant_a');
    const { room } = rooms.open({
      tenantId: 'tenant_a',
      name: 'Incidents',
      purpose: 'production errors and the people who own them',
      founder: ada,
      visibility: 'private',
    });

    rooms.admit(room.roomId, ada, scout);
    rooms.enter(room.roomId, scout);

    const said = rooms.post(room.roomId, ada, {
      kind: 'say',
      statement: 'have we seen this error before?',
      mentions: [scout.actorId],
    });
    const delegated = rooms.post(room.roomId, scout, {
      kind: 'handoff',
      handoff: handoff(scout),
    });
    const decided = rooms.post(room.roomId, ada, {
      kind: 'decision',
      statement: 'page the last deployer only if it recurs',
    });

    expect(said.authorId).toBe(ada.actorId);
    expect(said.authorType).toBe('human');
    expect(delegated.authorId).toBe(scout.actorId);
    expect(delegated.authorType).toBe('agent');
    expect(delegated.kind).toBe('handoff');
    if (delegated.kind === 'handoff') {
      expect(delegated.handoff.need).toBe('check whether we have seen this error');
      expect(delegated.handoff.facts[0]?.statement).toContain('PASTED_TRANSCRIPT');
    }

    const log = rooms.timeline(room.roomId, scout);
    expect(log.map((entry) => entry.kind)).toEqual([
      'presence',
      'presence',
      'say',
      'handoff',
      'decision',
    ]);
    expect(log.at(-1)).toMatchObject({ kind: 'decision', authorName: 'Ada' });
    expect(decided.authorType).toBe('human');

    const who = rooms.present(room.roomId, ada).map((member) => member.actorType);
    expect(who.sort()).toEqual(['agent', 'human']);
  });

  it('refuses outsiders, private self-join, and an agent from another tenant', () => {
    const rooms = new SharedRoom(new ManualClock());
    const ada = human();
    const scout = agent('tenant_a');
    const outsider = agent('tenant_b', 'Other');
    const { room } = rooms.open({
      tenantId: 'tenant_a',
      name: 'Incidents',
      purpose: 'keep the tenant boundary',
      founder: ada,
      visibility: 'private',
    });

    expect(() => rooms.timeline(room.roomId, scout)).toThrow(PermissionDeniedError);
    expect(() => rooms.post(room.roomId, scout, { kind: 'say', statement: 'hello' })).toThrow(
      PermissionDeniedError,
    );
    expect(() => rooms.join(room.roomId, scout, 'tenant_a')).toThrow(PermissionDeniedError);
    expect(() => rooms.admit(room.roomId, ada, outsider)).toThrow(PermissionDeniedError);
    expect(() => rooms.timeline(newRoomId(), ada)).toThrow(NotFoundError);
  });

  it('lets a same-tenant actor join an open room and keeps a second enter quiet', () => {
    const rooms = new SharedRoom(new ManualClock());
    const ada = human();
    const scout = agent('tenant_a');
    const { room } = rooms.open({
      tenantId: 'tenant_a',
      name: 'Floor',
      purpose: 'anyone on the tenant',
      founder: ada,
      visibility: 'open',
    });

    expect(() => rooms.join(room.roomId, scout, 'tenant_b')).toThrow(PermissionDeniedError);
    const joined = rooms.join(room.roomId, scout, 'tenant_a');
    expect(joined.actorType).toBe('agent');
    expect(rooms.present(room.roomId, ada).map((member) => member.actorId)).toEqual([
      ada.actorId,
    ]);

    const entered = rooms.enter(room.roomId, scout);
    const again = rooms.enter(room.roomId, scout);
    expect(again.entryId).toBe(entered.entryId);
    const presence = rooms
      .timeline(room.roomId, ada)
      .filter((entry) => entry.kind === 'presence' && entry.authorId === scout.actorId);
    expect(presence).toHaveLength(1);

    rooms.leave(room.roomId, scout);
    expect(rooms.present(room.roomId, ada).map((member) => member.actorId)).toEqual([
      ada.actorId,
    ]);
    expect(() => rooms.leave(room.roomId, scout)).toThrow(InvalidStateTransitionError);
  });

  it('rejects a forged handoff author and a message that is not a handoff', () => {
    const rooms = new SharedRoom(new ManualClock());
    const ada = human();
    const scout = agent('tenant_a');
    const { room } = rooms.open({
      tenantId: 'tenant_a',
      name: 'Incidents',
      purpose: 'authors are themselves',
      founder: ada,
    });
    rooms.admit(room.roomId, ada, scout);

    expect(() =>
      rooms.post(room.roomId, scout, {
        kind: 'handoff',
        handoff: createAgentHandoff({
          kind: 'delegation',
          need: 'pretend to be someone else',
          confidence: 0.4,
          fromAgentId: newAgentId(),
        }),
      }),
    ).toThrow(ValidationError);

    expect(() =>
      rooms.post(room.roomId, ada, {
        kind: 'handoff',
        handoff: handoff(scout),
      }),
    ).toThrow(ValidationError);

    expect(() =>
      rooms.post(room.roomId, ada, {
        kind: 'handoff',
        handoff: { transcript: 'the whole chat' } as unknown as AgentHandoff,
      }),
    ).toThrow(ValidationError);

    expect(() => rooms.post(room.roomId, ada, { kind: 'say', statement: '' })).toThrow(
      ValidationError,
    );
  });

  it('surfaces mentions and addressed handoffs as attention, and nothing else', () => {
    const rooms = new SharedRoom(new ManualClock());
    const ada = human();
    const scout = agent('tenant_a');
    const { room } = rooms.open({
      tenantId: 'tenant_a',
      name: 'Incidents',
      purpose: 'what needs you',
      founder: ada,
    });
    rooms.admit(room.roomId, ada, scout);

    rooms.post(room.roomId, ada, {
      kind: 'say',
      statement: 'scout, was this the march outage?',
      mentions: [scout.actorId],
    });
    rooms.post(room.roomId, ada, {
      kind: 'say',
      statement: 'note to myself',
    });
    rooms.post(room.roomId, scout, {
      kind: 'handoff',
      handoff: handoff(scout, scout),
    });
    rooms.post(room.roomId, ada, {
      kind: 'decision',
      statement: 'leave the old thread pinned',
    });

    const forScout = rooms.attention(room.roomId, scout);
    expect(forScout.map((entry) => entry.kind)).toEqual(['say', 'handoff']);
    expect(rooms.attention(room.roomId, ada)).toEqual([]);

    expect(() =>
      rooms.post(room.roomId, ada, {
        kind: 'say',
        statement: 'ping a stranger',
        mentions: [agent('tenant_a', 'Ghost').actorId],
      }),
    ).toThrow(ValidationError);
  });
});
