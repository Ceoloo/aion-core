import { z } from 'zod';
import { ActionTier } from './action-tier.js';
import type { AgentActor } from './actor.js';
import { DelegatedAuthority } from './authority.js';

/**
 * Agent Identity Registry (AIO-44 / SIS-AG-02).
 *
 * Every production agent / non-human worker must carry the mandatory registry
 * fields before Execute-tier work is allowed. This module defines the SIS field
 * export shape, completeness checks, and governance review helpers. Persistence
 * lives in aion-data; the Runtime gateway exposes the management path.
 *
 * See:
 * - aion-docs/architecture/security-infrastructure-standard-v1.md §3.9
 * - aion-docs/architecture/agent-identity-registry.md
 */

/** Revocation / contain state for a registered agent (SIS-AG-02 / SIS-AG-09). */
export const REVOCATION_STATES = ['active', 'suspended', 'revoked'] as const;
export const RevocationState = z.enum(REVOCATION_STATES);
export type RevocationState = z.infer<typeof RevocationState>;

/**
 * Operational environment the agent is registered for. Distinct from autonomy
 * grant environments — this is the registry's deployment posture label.
 */
export const REGISTRY_ENVIRONMENTS = [
  'development',
  'staging',
  'production',
] as const;
export const RegistryEnvironment = z.enum(REGISTRY_ENVIRONMENTS);
export type RegistryEnvironment = z.infer<typeof RegistryEnvironment>;

/**
 * SIS-AG-02 mandatory field names (snake_case export for inventory / audit).
 * Core Actor fields map onto these; see {@link toAgentRegistryRecord}.
 */
export const SIS_AG02_FIELDS = [
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
export type SisAg02Field = (typeof SIS_AG02_FIELDS)[number];

/**
 * Canonical registry export record — the inventory / audit shape.
 * Uses SIS field names so scorecard evidence and CI gates share one vocabulary.
 */
export const AgentRegistryRecord = z.object({
  agent_id: z.string().min(1),
  human_owner: z.string().min(1),
  business_purpose: z.string().min(1),
  tenant: z.string().min(1),
  permission_tier: ActionTier,
  tools: z.array(z.string()),
  data_scope: z.array(z.string()),
  delegated_authority: DelegatedAuthority,
  policy_version: z.string().min(1),
  execution_evidence: z.string().min(1),
  revocation_state: RevocationState,
  // Operational fields retained from prior scope (useful, not SIS-mandatory).
  actor_id: z.string().min(1).optional(),
  agent_uri: z.string().min(1).optional(),
  environment: RegistryEnvironment.optional(),
  credential_method: z.string().min(1).optional(),
  approval_requirements: z.array(z.string()).optional(),
  last_activity: z.string().datetime().optional(),
  domain: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
});
export type AgentRegistryRecord = z.infer<typeof AgentRegistryRecord>;

/** Result of a SIS-AG-02 completeness check. */
export interface RegistryCompleteness {
  ok: boolean;
  /** Missing SIS field names (empty when ok). */
  missing: SisAg02Field[];
  /** Human-readable detail for policy / review. */
  detail: string;
}

/**
 * True when the agent carries every SIS-AG-02 mandatory field with a usable
 * value. Empty tool / data allow-lists are valid (least privilege); the arrays
 * must be present (AgentActor defaults them). `delegated_authority`,
 * `policy_version`, `execution_evidence`, and `permission_tier` must be set.
 */
export function registryCompleteness(agent: AgentActor): RegistryCompleteness {
  const missing: SisAg02Field[] = [];

  const agentId = agent.agentUri ?? agent.agentId;
  if (!agentId) missing.push('agent_id');
  if (!agent.owner?.trim()) missing.push('human_owner');
  if (!agent.purpose?.trim()) missing.push('business_purpose');
  if (!agent.tenantId?.trim()) missing.push('tenant');
  if (!agent.actionTier) missing.push('permission_tier');
  // tools / data_scope: arrays always present on AgentActor (default []).
  if (!agent.delegatedAuthority) missing.push('delegated_authority');
  if (!agent.policyVersion?.trim()) missing.push('policy_version');
  if (!agent.executionEvidence?.trim()) missing.push('execution_evidence');
  if (!agent.revocationState) missing.push('revocation_state');

  if (missing.length === 0) {
    return {
      ok: true,
      missing: [],
      detail: 'SIS-AG-02 registry fields complete',
    };
  }
  return {
    ok: false,
    missing,
    detail: `SIS-AG-02 incomplete: missing [${missing.join(', ')}]`,
  };
}

/**
 * Project an AgentActor onto the SIS inventory export shape.
 * Throws when the agent is incomplete — callers that need a partial view should
 * use {@link registryCompleteness} first and export only complete rows.
 */
export function toAgentRegistryRecord(agent: AgentActor): AgentRegistryRecord {
  const completeness = registryCompleteness(agent);
  if (!completeness.ok) {
    throw new Error(completeness.detail);
  }
  return AgentRegistryRecord.parse({
    agent_id: agent.agentUri ?? agent.agentId,
    human_owner: agent.owner,
    business_purpose: agent.purpose,
    tenant: agent.tenantId!,
    permission_tier: agent.actionTier!,
    tools: agent.allowedTools.map(String),
    data_scope: agent.allowedData.map(String),
    delegated_authority: agent.delegatedAuthority!,
    policy_version: agent.policyVersion!,
    execution_evidence: agent.executionEvidence!,
    revocation_state: agent.revocationState ?? 'active',
    actor_id: agent.actorId,
    ...(agent.agentUri ? { agent_uri: agent.agentUri } : {}),
    ...(agent.environment ? { environment: agent.environment } : {}),
    ...(agent.credentialMethod
      ? { credential_method: agent.credentialMethod }
      : {}),
    ...(agent.approvalRequirements
      ? { approval_requirements: agent.approvalRequirements }
      : {}),
    ...(agent.lastActivity ? { last_activity: agent.lastActivity } : {}),
    ...(agent.domain ? { domain: agent.domain } : {}),
    ...(agent.role ? { role: agent.role } : {}),
  });
}

/** One finding from a governance review (SIS-AG-10). */
export interface RegistryReviewFinding {
  /** Stable finding code for CI / audit. */
  code:
    | 'incomplete_registry'
    | 'revoked_still_listed'
    | 'unknown_agent'
    | 'orphaned_agent'
    | 'execute_without_complete_registry';
  severity: 'hard_stop' | 'high' | 'medium';
  agentId: string;
  actorId?: string;
  detail: string;
  missing?: SisAg02Field[];
}

export interface RegistryGovernanceReview {
  /** True when no hard-stop findings. */
  ok: boolean;
  findings: RegistryReviewFinding[];
  completeCount: number;
  incompleteCount: number;
  reviewedAt: string;
}

export interface GovernanceReviewInput {
  /** Registered agents (from Data / inventory). */
  registered: readonly AgentActor[];
  /**
   * Agent ids observed in the wild (executions, configs, product clients)
   * that must appear in the registry. Unknown = orphan / fail governance.
   */
  observedAgentIds?: readonly string[];
  /**
   * When true, incomplete registry on any Execute-tier (or L2+) agent is a
   * hard-stop. Default true (SIS-AG-02 + SIS-AG-10).
   */
  failIncompleteExecute?: boolean;
  now?: string;
}

/**
 * SIS-AG-10 governance review: orphaned / unknown / incomplete agents fail.
 * Used by Runtime `GET /v1/registry/review` and inventory CI gates.
 */
export function reviewAgentRegistry(
  input: GovernanceReviewInput,
): RegistryGovernanceReview {
  const now = input.now ?? new Date().toISOString();
  const failIncompleteExecute = input.failIncompleteExecute !== false;
  const findings: RegistryReviewFinding[] = [];
  let completeCount = 0;
  let incompleteCount = 0;

  const byCanonicalId = new Map<string, AgentActor>();
  for (const agent of input.registered) {
    const canonical = agent.agentUri ?? agent.agentId;
    byCanonicalId.set(canonical, agent);
    byCanonicalId.set(agent.agentId, agent);
    byCanonicalId.set(agent.actorId, agent);

    const completeness = registryCompleteness(agent);
    if (completeness.ok) {
      completeCount += 1;
    } else {
      incompleteCount += 1;
      const isExecute =
        agent.actionTier === 'execute' ||
        (agent.actionTier === undefined &&
          (agent.autonomyLevel === 'L2' ||
            agent.autonomyLevel === 'L3' ||
            agent.autonomyLevel === 'L4'));
      findings.push({
        code: isExecute && failIncompleteExecute
          ? 'execute_without_complete_registry'
          : 'incomplete_registry',
        severity:
          isExecute && failIncompleteExecute ? 'hard_stop' : 'high',
        agentId: canonical,
        actorId: agent.actorId,
        detail: completeness.detail,
        missing: completeness.missing,
      });
    }

    if (agent.revocationState === 'revoked') {
      // Listed revoked agents are fine — they document containment. No finding.
    }
  }

  for (const observed of input.observedAgentIds ?? []) {
    if (!byCanonicalId.has(observed)) {
      findings.push({
        code: 'unknown_agent',
        severity: 'hard_stop',
        agentId: observed,
        detail: `observed agent "${observed}" is not in the Agent Identity Registry (SIS-AG-10)`,
      });
    }
  }

  // Orphan: registered agent with no owner / tenant (cannot be accountable).
  for (const agent of input.registered) {
    if (!agent.owner?.trim() || !agent.tenantId?.trim()) {
      const canonical = agent.agentUri ?? agent.agentId;
      if (!findings.some((f) => f.agentId === canonical && f.code === 'orphaned_agent')) {
        findings.push({
          code: 'orphaned_agent',
          severity: 'hard_stop',
          agentId: canonical,
          actorId: agent.actorId,
          detail: `agent "${canonical}" lacks human_owner and/or tenant — orphaned for governance`,
        });
      }
    }
  }

  const hardStops = findings.filter((f) => f.severity === 'hard_stop');
  return {
    ok: hardStops.length === 0,
    findings,
    completeCount,
    incompleteCount,
    reviewedAt: now,
  };
}

/** True when the agent is allowed to perform work (not suspended/revoked). */
export function registryAllowsExecution(agent: AgentActor): boolean {
  const state = agent.revocationState ?? 'active';
  return state === 'active';
}
