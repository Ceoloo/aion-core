import { z } from 'zod';
import { ActionTier, actionTierFromAutonomy } from './action-tier.js';
import { AgentUri } from './agent-identity.js';
import { AuthorityId } from './authority.js';
import type { AgentActor } from './actor.js';
import { AgentId, ToolId } from './identifiers.js';

/**
 * Agent Identity Registry (AIO-44 / SIS-AG-*).
 *
 * Production agents are first-class identities. The registry answers:
 *   Where are my agents? What can they do? What are they doing? How do I stop them?
 *
 * {@link AgentActor} remains the durable runtime grant shape. This module defines
 * the **production-complete registry view**, completeness validation (fail-closed
 * for Execute-tier governance), and revocation helpers. Incomplete agents may
 * still exist as Actor rows during migration, but they fail
 * {@link assertAgentRegistryComplete} and must not be treated as inventory-ready.
 */

export const AGENT_REVOCATION_STATES = [
  'active',
  'suspended',
  'revoked',
] as const;
export const AgentRevocationState = z.enum(AGENT_REVOCATION_STATES);
export type AgentRevocationState = z.infer<typeof AgentRevocationState>;

export const AGENT_REGISTRY_ENVIRONMENTS = [
  'development',
  'staging',
  'production',
] as const;
export const AgentRegistryEnvironment = z.enum(AGENT_REGISTRY_ENVIRONMENTS);
export type AgentRegistryEnvironment = z.infer<typeof AgentRegistryEnvironment>;

/** SIS-AG-02 mandatory fields — canonical registry record. */
export const AgentRegistryRecord = z.object({
  agentId: AgentId,
  agentUri: AgentUri.optional(),
  actorId: z.string().min(1),
  humanOwner: z.string().min(1),
  businessPurpose: z.string().min(1),
  tenant: z.string().min(1),
  permissionTier: ActionTier,
  tools: z.array(ToolId).default([]),
  dataScope: z.array(z.string().min(1)).default([]),
  /** Traceable delegated authority id (`auth_…`), when one is bound. */
  delegatedAuthorityId: AuthorityId.optional(),
  /**
   * Free-form delegated-authority evidence when a durable Authority row is not
   * yet linked (e.g. "root grant by operator-alex 2026-10-05").
   */
  delegatedAuthority: z.string().min(1),
  policyVersion: z.string().min(1),
  /** Pointer to attributable execution / audit evidence (URI, path, or query). */
  executionEvidence: z.string().min(1),
  revocationState: AgentRevocationState,
  environment: AgentRegistryEnvironment.optional(),
  credentialMethod: z.string().min(1).optional(),
  approvalRequirements: z.array(z.string().min(1)).default([]),
  lastActivityAt: z.string().datetime().optional(),
});
export type AgentRegistryRecord = z.infer<typeof AgentRegistryRecord>;

export const AGENT_REGISTRY_MANDATORY_FIELDS = [
  'agent_id',
  'human_owner',
  'business_purpose',
  'tenant',
  'permission_tier',
  'tools',
  'data_scope',
  'delegated_authority',
  'policy_version',
  'execution_evidence',
  'revocation_state',
] as const;
export type AgentRegistryMandatoryField =
  (typeof AGENT_REGISTRY_MANDATORY_FIELDS)[number];

export type AgentRegistryCompleteness = {
  ok: boolean;
  missing: AgentRegistryMandatoryField[];
  detail: string;
};

function effectivePermissionTier(agent: AgentActor): ActionTier | undefined {
  if (agent.actionTier) return agent.actionTier;
  if (agent.autonomyLevel) return actionTierFromAutonomy(agent.autonomyLevel);
  return undefined;
}

/**
 * Map an AgentActor onto the SIS registry field set and report gaps.
 * Does not throw — use {@link assertAgentRegistryComplete} to fail closed.
 */
export function inspectAgentRegistryCompleteness(
  agent: AgentActor,
): AgentRegistryCompleteness {
  const missing: AgentRegistryMandatoryField[] = [];
  if (!agent.agentId) missing.push('agent_id');
  if (!agent.owner?.trim()) missing.push('human_owner');
  if (!agent.purpose?.trim()) missing.push('business_purpose');
  if (!agent.tenantId?.trim()) missing.push('tenant');
  if (!effectivePermissionTier(agent)) missing.push('permission_tier');
  // tools + data_scope may be empty arrays (Observe-only) but must be present.
  if (!Array.isArray(agent.allowedTools)) missing.push('tools');
  if (!Array.isArray(agent.allowedData)) missing.push('data_scope');
  const delegated =
    agent.delegatedAuthorityId ||
    agent.delegatedAuthorityEvidence?.trim() ||
    '';
  if (!delegated) missing.push('delegated_authority');
  if (!agent.policyVersion?.trim()) missing.push('policy_version');
  if (!agent.executionEvidence?.trim()) missing.push('execution_evidence');
  if (!agent.revocationState) missing.push('revocation_state');

  if (missing.length === 0) {
    return {
      ok: true,
      missing: [],
      detail: `agent ${agent.agentId} satisfies SIS-AG-02 registry fields`,
    };
  }
  return {
    ok: false,
    missing,
    detail: `agent ${agent.agentId ?? agent.actorId} missing registry fields: [${missing.join(', ')}]`,
  };
}

/** Fail closed when mandatory registry fields are incomplete. */
export function assertAgentRegistryComplete(
  agent: AgentActor,
): AgentRegistryCompleteness {
  const result = inspectAgentRegistryCompleteness(agent);
  if (!result.ok) {
    throw new Error(result.detail);
  }
  return result;
}

/** True when the agent may be treated as a production inventory entry. */
export function isAgentRegistryComplete(agent: AgentActor): boolean {
  return inspectAgentRegistryCompleteness(agent).ok;
}

/**
 * Project a complete AgentActor into the canonical registry record.
 * Throws when SIS-AG-02 fields are incomplete.
 */
export function toAgentRegistryRecord(agent: AgentActor): AgentRegistryRecord {
  assertAgentRegistryComplete(agent);
  const permissionTier = effectivePermissionTier(agent)!;
  const delegatedAuthority =
    agent.delegatedAuthorityEvidence?.trim() ||
    String(agent.delegatedAuthorityId);

  return AgentRegistryRecord.parse({
    agentId: agent.agentId,
    ...(agent.agentUri ? { agentUri: agent.agentUri } : {}),
    actorId: agent.actorId,
    humanOwner: agent.owner,
    businessPurpose: agent.purpose,
    tenant: agent.tenantId!,
    permissionTier,
    tools: agent.allowedTools,
    dataScope: agent.allowedData,
    ...(agent.delegatedAuthorityId
      ? { delegatedAuthorityId: agent.delegatedAuthorityId }
      : {}),
    delegatedAuthority,
    policyVersion: agent.policyVersion!,
    executionEvidence: agent.executionEvidence!,
    revocationState: agent.revocationState!,
    ...(agent.environment ? { environment: agent.environment } : {}),
    ...(agent.credentialMethod
      ? { credentialMethod: agent.credentialMethod }
      : {}),
    approvalRequirements: agent.approvalRequirements ?? [],
    ...(agent.lastActivityAt ? { lastActivityAt: agent.lastActivityAt } : {}),
  });
}

export type AgentRegistryInventoryEntry = {
  record: AgentRegistryRecord | null;
  actor: AgentActor;
  complete: boolean;
  missing: AgentRegistryMandatoryField[];
};

/** Inventory export: every agent listed; incomplete ones fail governance review. */
export function buildAgentRegistryInventory(
  agents: readonly AgentActor[],
): {
  entries: AgentRegistryInventoryEntry[];
  completeCount: number;
  incompleteCount: number;
  orphanCount: number;
} {
  const entries: AgentRegistryInventoryEntry[] = agents.map((actor) => {
    const inspection = inspectAgentRegistryCompleteness(actor);
    return {
      actor,
      complete: inspection.ok,
      missing: inspection.missing,
      record: inspection.ok ? toAgentRegistryRecord(actor) : null,
    };
  });
  const completeCount = entries.filter((e) => e.complete).length;
  const incompleteCount = entries.length - completeCount;
  // Orphan = agent without human owner or without tenant (unattributable).
  const orphanCount = entries.filter(
    (e) =>
      e.missing.includes('human_owner') || e.missing.includes('tenant'),
  ).length;
  return { entries, completeCount, incompleteCount, orphanCount };
}

/** Apply a revocation / containment transition on an agent actor. */
export function withAgentRevocationState(
  agent: AgentActor,
  state: AgentRevocationState,
  atIso: string,
): AgentActor {
  return {
    ...agent,
    revocationState: state,
    lastActivityAt: atIso,
    metadata: {
      ...agent.metadata,
      revocationTransitionAt: atIso,
      priorRevocationState: agent.revocationState ?? 'active',
    },
  };
}

export function isAgentExecutionAllowed(agent: AgentActor): boolean {
  const state = agent.revocationState ?? 'active';
  return state === 'active';
}
