import { z } from 'zod';
import { AgentHandoff } from './agent-handoff.js';
import { ActorType } from './actor.js';
import { ActorId, AgentId, RoomEntryId, RoomId } from './identifiers.js';

/**
 * A shared room.
 *
 * Humans and agents are members of the same place. Membership is the gate.
 * The timeline is one log: a say, a handoff, a decision, and presence are the
 * same kind of entry, each attributed to the author's own actor. Posting in
 * the room does not authorize execution.
 */
export const ROOM_VISIBILITIES = ['open', 'private'] as const;
export const RoomVisibility = z.enum(ROOM_VISIBILITIES);
export type RoomVisibility = z.infer<typeof RoomVisibility>;

export const Room = z.object({
  roomId: RoomId,
  /** Tenant boundary. A room never mixes tenants. */
  tenantId: z.string().min(1),
  name: z.string().min(1),
  purpose: z.string().min(1),
  /**
   * `open` — a same-tenant actor may join.
   * `private` — only an existing member may admit someone.
   */
  visibility: RoomVisibility.default('private'),
  createdAt: z.string().datetime(),
});
export type Room = z.infer<typeof Room>;

export const RoomMembership = z.object({
  roomId: RoomId,
  actorId: ActorId,
  actorType: ActorType,
  name: z.string().min(1),
  /** Set for agent members so a handoff can be checked against the author. */
  agentId: AgentId.optional(),
  admittedAt: z.string().datetime(),
});
export type RoomMembership = z.infer<typeof RoomMembership>;

const entryBase = {
  entryId: RoomEntryId,
  roomId: RoomId,
  authorId: ActorId,
  authorType: ActorType,
  authorName: z.string().min(1),
  createdAt: z.string().datetime(),
};

/** A bounded statement. Not a transcript and not an instruction to execute. */
const statement = z.string().min(1).max(2000);

export const RoomEntry = z.discriminatedUnion('kind', [
  z.object({
    ...entryBase,
    kind: z.literal('say'),
    statement,
    mentions: z.array(ActorId).default([]),
  }),
  z.object({
    ...entryBase,
    kind: z.literal('handoff'),
    handoff: AgentHandoff,
  }),
  z.object({
    ...entryBase,
    kind: z.literal('decision'),
    statement,
  }),
  z.object({
    ...entryBase,
    kind: z.literal('presence'),
    change: z.enum(['entered', 'left']),
  }),
]);
export type RoomEntry = z.infer<typeof RoomEntry>;
