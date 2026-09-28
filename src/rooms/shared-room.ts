import type { AgentHandoff } from '../contracts/agent-handoff.js';
import { AgentHandoff as AgentHandoffSchema } from '../contracts/agent-handoff.js';
import type { Actor } from '../contracts/actor.js';
import type { ActorId, RoomId } from '../contracts/identifiers.js';
import { newRoomEntryId, newRoomId } from '../contracts/identifiers.js';
import {
  Room,
  RoomEntry,
  RoomMembership,
  type RoomVisibility,
} from '../contracts/room.js';
import {
  InvalidStateTransitionError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from '../errors/index.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';

/**
 * SharedRoom — one workspace where humans and agents are colleagues.
 *
 * Stolen from the part of Buzz worth keeping, and stopped there:
 *  - Membership is the only gate. An agent is admitted the same way a person is.
 *  - One timeline. Say, handoff, decision, and presence are attributed to the
 *    author's own actor. Nobody posts as someone else.
 *  - A handoff on the timeline is an AgentHandoff. It is a message, not a grant
 *    to run tools. This module has no orchestrator and cannot dispatch work.
 *  - Presence is explicit. Entering twice does not write a second row.
 *  - The room is one tenant. An agent from another tenant cannot join or be admitted.
 *
 * In-process state, same posture as the rest of the kernel. Not a chat product,
 * not a relay, not an execution backend.
 */
export interface OpenRoomInput {
  tenantId: string;
  name: string;
  purpose: string;
  founder: Actor;
  visibility?: RoomVisibility;
}

export type RoomPost =
  | { kind: 'say'; statement: string; mentions?: ActorId[] }
  | { kind: 'handoff'; handoff: AgentHandoff }
  | { kind: 'decision'; statement: string };

export class SharedRoom {
  private readonly clock: Clock;
  private readonly rooms = new Map<RoomId, Room>();
  private readonly memberships = new Map<RoomId, Map<string, RoomMembership>>();
  private readonly entries = new Map<RoomId, RoomEntry[]>();
  /** Actor id → presence entry id, for members currently inside. */
  private readonly inside = new Map<RoomId, Map<string, RoomEntry['entryId']>>();

  constructor(clock?: Clock) {
    this.clock = clock ?? systemClock;
  }

  /** Create a room, admit the founder, and mark them present. */
  open(input: OpenRoomInput): { room: Room; membership: RoomMembership } {
    if (input.tenantId.trim().length === 0) {
      throw new ValidationError('tenantId is required', { field: 'tenantId' });
    }
    assertActorTenant(input.founder, input.tenantId);
    const now = this.clock.isoNow();
    const room = Room.parse({
      roomId: newRoomId(),
      tenantId: input.tenantId,
      name: input.name,
      purpose: input.purpose,
      visibility: input.visibility ?? 'private',
      createdAt: now,
    });
    this.rooms.set(room.roomId, room);
    this.memberships.set(room.roomId, new Map());
    this.entries.set(room.roomId, []);
    this.inside.set(room.roomId, new Map());
    const membership = this.putMember(room, input.founder, now);
    this.writePresence(room, membership, 'entered');
    return { room: this.viewRoom(room), membership: this.viewMembership(membership) };
  }

  /**
   * Self-join an open room. `tenantId` is the caller's tenant as resolved by
   * the composition root. Agents must also carry that tenant on the actor.
   */
  join(roomId: RoomId, actor: Actor, tenantId: string): RoomMembership {
    const room = this.requireRoom(roomId);
    if (room.visibility !== 'open') {
      throw new PermissionDeniedError('private room is invite-only', {
        roomId,
        reason: 'INVITE_ONLY',
      });
    }
    if (tenantId !== room.tenantId) {
      throw new PermissionDeniedError('tenant does not match the room', {
        roomId,
        reason: 'TENANT_MISMATCH',
      });
    }
    assertActorTenant(actor, room.tenantId);
    const existing = this.memberships.get(roomId)?.get(actor.actorId);
    if (existing) return this.viewMembership(existing);
    return this.viewMembership(this.putMember(room, actor, this.clock.isoNow()));
  }

  /** A member invites someone into the room. Same tenant rules as join. */
  admit(roomId: RoomId, by: Actor, actor: Actor): RoomMembership {
    const room = this.requireRoom(roomId);
    this.requireMember(roomId, by);
    assertActorTenant(actor, room.tenantId);
    const existing = this.memberships.get(roomId)?.get(actor.actorId);
    if (existing) return this.viewMembership(existing);
    return this.viewMembership(this.putMember(room, actor, this.clock.isoNow()));
  }

  /** Mark a member present. A second enter does not append another row. */
  enter(roomId: RoomId, actor: Actor): RoomEntry {
    const room = this.requireRoom(roomId);
    const member = this.requireMember(roomId, actor);
    const already = this.inside.get(roomId)?.get(actor.actorId);
    if (already) {
      const prior = this.entries.get(roomId)?.find((entry) => entry.entryId === already);
      if (prior) return this.viewEntry(prior);
    }
    return this.viewEntry(this.writePresence(room, member, 'entered'));
  }

  /** Mark a member absent. Leaving without being present is an error. */
  leave(roomId: RoomId, actor: Actor): RoomEntry {
    const room = this.requireRoom(roomId);
    const member = this.requireMember(roomId, actor);
    if (!this.inside.get(roomId)?.has(actor.actorId)) {
      throw new InvalidStateTransitionError(
        `actor ${actor.actorId} is not present in room ${roomId}`,
        { roomId, actorId: actor.actorId },
      );
    }
    this.inside.get(roomId)?.delete(actor.actorId);
    return this.viewEntry(this.writePresence(room, member, 'left'));
  }

  /**
   * Append one timeline entry attributed to `actor`. The author fields are
   * taken from the membership, never from the post body.
   */
  post(roomId: RoomId, actor: Actor, post: RoomPost): RoomEntry {
    const room = this.requireRoom(roomId);
    const member = this.requireMember(roomId, actor);
    const now = this.clock.isoNow();
    const base = {
      entryId: newRoomEntryId(),
      roomId: room.roomId,
      authorId: member.actorId,
      authorType: member.actorType,
      authorName: member.name,
      createdAt: now,
    };

    let entry: RoomEntry;
    if (post.kind === 'say') {
      const mentions = post.mentions ?? [];
      for (const mentioned of mentions) {
        if (!this.memberships.get(roomId)?.has(mentioned)) {
          throw new ValidationError('mention is not a member of the room', {
            roomId,
            actorId: mentioned,
          });
        }
      }
      entry = parseEntry({ ...base, kind: 'say', statement: post.statement, mentions });
    } else if (post.kind === 'decision') {
      entry = parseEntry({ ...base, kind: 'decision', statement: post.statement });
    } else {
      const handoff = parseHandoff(post.handoff);
      if (member.actorType === 'agent') {
        if (handoff.fromAgentId && handoff.fromAgentId !== member.agentId) {
          throw new ValidationError('handoff fromAgentId does not match the posting agent', {
            roomId,
            fromAgentId: handoff.fromAgentId,
          });
        }
      } else if (handoff.fromAgentId) {
        throw new ValidationError('a human post cannot attribute the handoff to an agent', {
          roomId,
          fromAgentId: handoff.fromAgentId,
        });
      }
      entry = parseEntry({ ...base, kind: 'handoff', handoff });
    }

    this.entries.get(roomId)?.push(entry);
    return this.viewEntry(entry);
  }

  /** The room log, oldest first. Members only. */
  timeline(roomId: RoomId, actor: Actor): RoomEntry[] {
    this.requireRoom(roomId);
    this.requireMember(roomId, actor);
    return (this.entries.get(roomId) ?? []).map((entry) => this.viewEntry(entry));
  }

  /** Members currently inside. Members only. */
  present(roomId: RoomId, actor: Actor): RoomMembership[] {
    this.requireRoom(roomId);
    this.requireMember(roomId, actor);
    const ids = this.inside.get(roomId);
    if (!ids) return [];
    const members = this.memberships.get(roomId);
    const listed: RoomMembership[] = [];
    for (const actorId of ids.keys()) {
      const member = members?.get(actorId);
      if (member) listed.push(this.viewMembership(member));
    }
    return listed;
  }

  /**
   * Entries this member should see without reading the whole room: says that
   * mention them, and handoffs addressed to their agent id or their name.
   */
  attention(roomId: RoomId, actor: Actor): RoomEntry[] {
    const member = this.requireMember(this.requireRoom(roomId).roomId, actor);
    return (this.entries.get(roomId) ?? [])
      .filter((entry) => addressedTo(entry, member))
      .map((entry) => this.viewEntry(entry));
  }

  members(roomId: RoomId, actor: Actor): RoomMembership[] {
    this.requireRoom(roomId);
    this.requireMember(roomId, actor);
    return [...(this.memberships.get(roomId)?.values() ?? [])].map((member) =>
      this.viewMembership(member),
    );
  }

  /** The room, for a member. */
  get(roomId: RoomId, actor: Actor): Room {
    const room = this.requireRoom(roomId);
    this.requireMember(roomId, actor);
    return this.viewRoom(room);
  }

  private putMember(room: Room, actor: Actor, admittedAt: string): RoomMembership {
    const membership = RoomMembership.parse(
      defined({
        roomId: room.roomId,
        actorId: actor.actorId,
        actorType: actor.actorType,
        name: actor.name,
        agentId: actor.actorType === 'agent' ? actor.agentId : undefined,
        admittedAt,
      }),
    );
    let bucket = this.memberships.get(room.roomId);
    if (!bucket) {
      bucket = new Map();
      this.memberships.set(room.roomId, bucket);
    }
    bucket.set(actor.actorId, membership);
    return membership;
  }

  private writePresence(
    room: Room,
    member: RoomMembership,
    change: 'entered' | 'left',
  ): RoomEntry {
    const entry = parseEntry({
      entryId: newRoomEntryId(),
      roomId: room.roomId,
      kind: 'presence',
      authorId: member.actorId,
      authorType: member.actorType,
      authorName: member.name,
      change,
      createdAt: this.clock.isoNow(),
    });
    this.entries.get(room.roomId)?.push(entry);
    if (change === 'entered') {
      let inside = this.inside.get(room.roomId);
      if (!inside) {
        inside = new Map();
        this.inside.set(room.roomId, inside);
      }
      inside.set(member.actorId, entry.entryId);
    }
    return entry;
  }

  private requireRoom(roomId: RoomId): Room {
    const room = this.rooms.get(roomId);
    if (!room) throw new NotFoundError(`room "${roomId}" not found`, { roomId });
    return room;
  }

  private requireMember(roomId: RoomId, actor: Actor): RoomMembership {
    const member = this.memberships.get(roomId)?.get(actor.actorId);
    if (!member || member.actorType !== actor.actorType) {
      throw new PermissionDeniedError('actor is not a member of the room', {
        roomId,
        actorId: actor.actorId,
        reason: 'NOT_A_MEMBER',
      });
    }
    return member;
  }

  private viewRoom(room: Room): Room {
    return Room.parse({ ...room });
  }

  private viewMembership(membership: RoomMembership): RoomMembership {
    return RoomMembership.parse(defined({ ...membership }));
  }

  private viewEntry(entry: RoomEntry): RoomEntry {
    return RoomEntry.parse(entry);
  }
}

function parseEntry(value: unknown): RoomEntry {
  const parsed = RoomEntry.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('invalid room entry', { issues: parsed.error.issues });
  }
  return parsed.data;
}

function assertActorTenant(actor: Actor, tenantId: string): void {
  if (actor.actorType !== 'agent') return;
  if (!actor.tenantId || actor.tenantId !== tenantId) {
    throw new PermissionDeniedError('agent tenant does not match the room', {
      actorId: actor.actorId,
      reason: 'TENANT_MISMATCH',
    });
  }
}

function parseHandoff(value: AgentHandoff): AgentHandoff {
  const parsed = AgentHandoffSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('room handoff must be an AgentHandoff', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function addressedTo(entry: RoomEntry, member: RoomMembership): boolean {
  if (entry.kind === 'say') return entry.mentions.includes(member.actorId);
  if (entry.kind !== 'handoff') return false;
  if (member.agentId && entry.handoff.toAgentId === member.agentId) return true;
  return entry.handoff.toLabel === member.name;
}

function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
