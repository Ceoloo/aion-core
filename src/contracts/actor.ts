import { z } from 'zod';
import { ActorId, AgentId, ToolId } from './identifiers.js';
import { Capability } from './capability.js';
import { RiskLevel } from './risk.js';
import { AutonomyLevel } from './autonomy.js';
import { AgentUri } from './agent-identity.js';

/**
 * Actor model.
 *
 * Every AION action must have an identifiable actor — there is no ambient or
 * "god" identity (aion-docs/architecture/security-model.md). Actors carry the
 * information the policy engine needs to authorize work: their granted
 * capabilities, allowed tools, explicit prohibitions, and a risk ceiling.
 *
 * Agents are NOT inherently trusted. An agent is a governed worker described by
 * a bounded specification (aion-docs/governance/agent-governance.md); its
 * permissions are declared, least-privilege, and enforced centrally.
 */

export const ACTOR_TYPES = ['human', 'agent', 'service', 'system'] as const;
export const ActorType = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof ActorType>;

/**
 * The base identity fields every actor carries. Deny-by-default: an actor may
 * only use capabilities in `permissions` and tools in `allowedTools`, and never
 * anything in `forbiddenCapabilities`.
 */
export const ActorBase = z.object({
  actorId: ActorId,
  actorType: ActorType,
  name: z.string().min(1),
  /** Capabilities this actor is explicitly granted (allow-list). */
  permissions: z.array(Capability).default([]),
  /** Tools this actor may invoke (allow-list). Empty means "no tools". */
  allowedTools: z.array(ToolId).default([]),
  /** Capabilities this actor may never perform, overriding any grant. */
  forbiddenCapabilities: z.array(Capability).default([]),
  /**
   * The highest risk level this actor may ever perform. An action classified
   * above this ceiling is denied outright — being permitted a capability is not
   * the same as being cleared to perform it at any risk.
   */
  maxRiskLevel: RiskLevel.default('R3'),
  metadata: z.record(z.unknown()).default({}),
});

/**
 * Agent-specific governance fields (aion-docs/governance/agent-governance.md).
 * An agent is a governed worker, so it additionally declares its purpose, the
 * human/team accountable for it, its default risk level, escalation
 * conditions, and a cost budget — plus the Week 1 identity / permission fields
 * (canonical URI, domain/role, allowed data, I/O contracts, evals, autonomy).
 */
export const AgentActor = ActorBase.extend({
  actorType: z.literal('agent'),
  agentId: AgentId,
  /**
   * Canonical attributable identity: `agent://aion/{domain}/{role}/{id}`.
   * Prefer this over display names when assigning work or writing executions.
   */
  agentUri: AgentUri.optional(),
  /** Domain this agent belongs to (revenue, media, infra, …). */
  domain: z.string().min(1).optional(),
  /** Role within the domain (pipeline-ops, script-writer, …). */
  role: z.string().min(1).optional(),
  /** Tenant / company scope for multi-venture isolation. */
  tenantId: z.string().min(1).optional(),
  /** The one job this agent exists to do. */
  purpose: z.string().min(1),
  /** The human or team accountable for this agent. */
  owner: z.string().min(1),
  /** The agent's default risk level; a specific action may classify higher. */
  defaultRiskLevel: RiskLevel.default('R1'),
  /** Declared autonomy ceiling; never raised by the worker itself. */
  autonomyLevel: AutonomyLevel.default('L1'),
  /** Conditions under which the agent must stop and escalate to a human. */
  escalationConditions: z.array(z.string()).default([]),
  /** Data scopes this agent may read/write — least privilege. */
  allowedData: z.array(z.string()).default([]),
  /** Shape of work this agent accepts (contract name or schema ref). */
  inputContract: z.string().min(1).optional(),
  /** Shape of results this agent returns (contract name or schema ref). */
  outputContract: z.string().min(1).optional(),
  /** How output quality is judged (eval ids / criteria). */
  evaluationCriteria: z.array(z.string()).default([]),
  /** What the agent must emit to remain traceable. */
  observabilityRequirements: z.array(z.string()).default([]),
  /** Cost ceiling (abstract units) for a single unit of work. */
  costBudget: z.number().nonnegative().optional(),
});

export const HumanActor = ActorBase.extend({
  actorType: z.literal('human'),
});

export const ServiceActor = ActorBase.extend({
  actorType: z.literal('service'),
});

export const SystemActor = ActorBase.extend({
  actorType: z.literal('system'),
});

/** Any actor. Discriminated on `actorType`. */
export const Actor = z.discriminatedUnion('actorType', [
  HumanActor,
  AgentActor,
  ServiceActor,
  SystemActor,
]);
export type Actor = z.infer<typeof Actor>;
export type AgentActor = z.infer<typeof AgentActor>;
export type HumanActor = z.infer<typeof HumanActor>;
export type ServiceActor = z.infer<typeof ServiceActor>;
export type SystemActor = z.infer<typeof SystemActor>;
