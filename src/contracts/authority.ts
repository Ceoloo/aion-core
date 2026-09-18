import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Capability } from './capability.js';
import { ToolId } from './identifiers.js';
import { RiskLevel, riskGreaterThan, maxRisk } from './risk.js';
import { AutonomyLevel, AUTONOMY_LEVELS } from './autonomy.js';
import { ProvenanceId } from './provenance.js';

/**
 * Delegated Authority contract.
 *
 * Authority answers the question the AION governance thesis (Sep 2026
 * Production Research Brief) names as a first-class primitive:
 *
 *   "What power has actually been delegated to this agent?"
 *
 * The existing {@link Actor} model records a *static* grant — the capabilities
 * an agent is configured with. Authority records the *effective* power a
 * principal handed down for a specific piece of work, and enforces the invariant
 * the brief calls out for the whole Agent OS:
 *
 *   authority(child) ⊆ authority(parent)
 *
 * A sub-agent can never hold more power than the orchestrator that spawned it,
 * an orchestrator never more than the operator, and so on down the principal
 * hierarchy. Delegation may only *attenuate* — narrow capabilities, lower the
 * risk ceiling, shrink the budget, tighten scope, shorten the lifetime. It can
 * never amplify. This closes the "authority amplification" gap: if the CEO
 * grants an orchestrator `crm.read`, a sub-agent cannot escalate itself into
 * `crm.write`.
 *
 * Authority is evaluated by the policy engine, never trusted on assertion. It
 * carries a {@link ProvenanceId} so the runtime can also answer *where* the
 * authority came from.
 */

/** The principal hierarchy, ordered from most to least authoritative. */
export const PRINCIPAL_KINDS = [
  'human',
  'operator',
  'orchestrator',
  'sub-agent',
  'tool',
] as const;
export const PrincipalKind = z.enum(PRINCIPAL_KINDS);
export type PrincipalKind = z.infer<typeof PrincipalKind>;

/** A node in the delegation chain: what kind of principal, and its stable ref. */
export const Principal = z.object({
  kind: PrincipalKind,
  /** actorId / agentUri / operator id — the attributable handle. */
  ref: z.string().min(1),
});
export type Principal = z.infer<typeof Principal>;

export const AUTHORITY_STATUSES = ['active', 'revoked', 'expired'] as const;
export const AuthorityStatus = z.enum(AUTHORITY_STATUSES);
export type AuthorityStatus = z.infer<typeof AuthorityStatus>;

/** Branded authority id (`auth_…`). */
export const AuthorityId = z
  .string()
  .min(6)
  .refine((value) => value.startsWith('auth_'), {
    message: 'AuthorityId must start with "auth_"',
  })
  .brand('AuthorityId');
export type AuthorityId = z.infer<typeof AuthorityId>;

export function newAuthorityId(): AuthorityId {
  return `auth_${randomUUID()}` as AuthorityId;
}

export const DelegatedAuthority = z.object({
  authorityId: AuthorityId,
  /** WHO holds this authority (the delegatee). */
  subject: Principal,
  /**
   * The delegation chain, root-first
   * (e.g. [human, operator, orchestrator, sub-agent]). Records the lineage of
   * principals this authority passed through.
   */
  principalChain: z.array(Principal).default([]),
  /** Parent authority this was attenuated from (absent for a root grant). */
  parentAuthorityId: AuthorityId.optional(),
  /** Tenant this authority is scoped to — delegation never crosses tenants. */
  tenantId: z.string().min(1),
  /** Optional company scope; a child may narrow but never broaden it. */
  companyId: z.string().min(1).optional(),

  // ── The actual delegated powers (allow-lists — never self-expanded) ────────
  capabilities: z.array(Capability).default([]),
  tools: z.array(ToolId).default([]),
  dataScopes: z.array(z.string().min(1)).default([]),

  // ── Ceilings — a child may never exceed its parent ─────────────────────────
  /** Highest risk this authority may reach. */
  maxRiskLevel: RiskLevel.default('R1'),
  /** Highest autonomy this authority may reach. */
  maxAutonomyLevel: AutonomyLevel.default('L1'),
  /** Remaining spend authority (abstract units). Unbounded when omitted. */
  budget: z.number().nonnegative().optional(),

  /** Origin of this authority — link to a Provenance record. */
  provenanceId: ProvenanceId.optional(),

  status: AuthorityStatus.default('active'),
  grantReason: z.string().min(1),
  createdAt: z.string().datetime(),
  /** When this authority stops being valid; a child may not outlive its parent. */
  expiresAt: z.string().datetime().optional(),
  revokedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type DelegatedAuthority = z.infer<typeof DelegatedAuthority>;

function autonomyRank(level: AutonomyLevel): number {
  return AUTONOMY_LEVELS.indexOf(level);
}

function minAutonomy(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return autonomyRank(a) <= autonomyRank(b) ? a : b;
}

/** Result of a subset (attenuation) check. */
export interface AuthoritySubsetResult {
  ok: boolean;
  /** One entry per dimension on which the child exceeds its parent. */
  violations: string[];
}

/**
 * Enforce the invariant `authority(child) ⊆ authority(parent)`.
 *
 * Returns `ok: true` only when the child is, on every dimension, no broader
 * than the parent: same tenant, no wider company scope, capabilities/tools/data
 * a subset, risk and autonomy ceilings no higher, budget no larger, and a
 * lifetime that does not outlast the parent. Every breach is reported so the
 * denial is fully explainable.
 */
export function authoritySubsumes(
  parent: DelegatedAuthority,
  child: DelegatedAuthority,
): AuthoritySubsetResult {
  const violations: string[] = [];

  if (child.tenantId !== parent.tenantId) {
    violations.push(
      `tenant escalation: child tenant "${child.tenantId}" != parent tenant "${parent.tenantId}"`,
    );
  }

  // A parent scoped to a company confines the child to that same company.
  if (parent.companyId && child.companyId !== parent.companyId) {
    violations.push(
      `company scope escape: parent is scoped to company "${parent.companyId}" but child is "${child.companyId ?? 'tenant-wide'}"`,
    );
  }

  const parentCaps = new Set(parent.capabilities.map(String));
  for (const cap of child.capabilities) {
    if (!parentCaps.has(String(cap))) {
      violations.push(`capability escalation: "${cap}" not held by parent`);
    }
  }

  const parentTools = new Set(parent.tools.map(String));
  for (const tool of child.tools) {
    if (!parentTools.has(String(tool))) {
      violations.push(`tool escalation: "${tool}" not held by parent`);
    }
  }

  const parentData = new Set(parent.dataScopes);
  for (const scope of child.dataScopes) {
    if (!parentData.has(scope)) {
      violations.push(`data-scope escalation: "${scope}" not held by parent`);
    }
  }

  if (riskGreaterThan(child.maxRiskLevel, parent.maxRiskLevel)) {
    violations.push(
      `risk escalation: child ceiling ${child.maxRiskLevel} > parent ceiling ${parent.maxRiskLevel}`,
    );
  }

  if (autonomyRank(child.maxAutonomyLevel) > autonomyRank(parent.maxAutonomyLevel)) {
    violations.push(
      `autonomy escalation: child ceiling ${child.maxAutonomyLevel} > parent ceiling ${parent.maxAutonomyLevel}`,
    );
  }

  if (parent.budget !== undefined) {
    if (child.budget === undefined) {
      violations.push(
        'budget escalation: parent budget is bounded but child budget is unbounded',
      );
    } else if (child.budget > parent.budget) {
      violations.push(
        `budget escalation: child budget ${child.budget} > parent budget ${parent.budget}`,
      );
    }
  }

  if (parent.expiresAt) {
    if (!child.expiresAt) {
      violations.push(
        'lifetime escalation: parent authority expires but child never does',
      );
    } else if (child.expiresAt > parent.expiresAt) {
      violations.push(
        `lifetime escalation: child expires ${child.expiresAt} after parent ${parent.expiresAt}`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

export interface AttenuateAuthorityInput {
  /** WHO the new authority is delegated to. */
  subject: Principal;
  grantReason: string;
  /** Requested capability subset; intersected with the parent's. */
  capabilities?: Capability[];
  tools?: ToolId[];
  dataScopes?: string[];
  /** Requested ceilings; each clamped down to the parent's. */
  maxRiskLevel?: RiskLevel;
  maxAutonomyLevel?: AutonomyLevel;
  budget?: number;
  companyId?: string;
  provenanceId?: ProvenanceId;
  expiresAt?: string;
  authorityId?: AuthorityId;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Derive a child authority from a parent, guaranteed to satisfy
 * `authoritySubsumes(parent, child).ok`. Delegation can only narrow:
 * capabilities/tools/data are intersected with the parent's, ceilings are
 * clamped down, budget is min-ed, tenant is fixed to the parent's, and the
 * lifetime is capped at the parent's expiry. This is the safe way to spawn a
 * worker's authority — it makes amplification unrepresentable rather than
 * merely detectable.
 */
export function attenuateAuthority(
  parent: DelegatedAuthority,
  input: AttenuateAuthorityInput,
): DelegatedAuthority {
  const parentCaps = new Set(parent.capabilities.map(String));
  const capabilities = (input.capabilities ?? parent.capabilities).filter((c) =>
    parentCaps.has(String(c)),
  );

  const parentTools = new Set(parent.tools.map(String));
  const tools = (input.tools ?? parent.tools).filter((t) =>
    parentTools.has(String(t)),
  );

  const parentData = new Set(parent.dataScopes);
  const dataScopes = (input.dataScopes ?? parent.dataScopes).filter((s) =>
    parentData.has(s),
  );

  // Clamp risk down: never above the parent ceiling.
  const requestedRisk = input.maxRiskLevel ?? parent.maxRiskLevel;
  const maxRiskLevel = riskGreaterThan(requestedRisk, parent.maxRiskLevel)
    ? parent.maxRiskLevel
    : requestedRisk;

  const requestedAutonomy = input.maxAutonomyLevel ?? parent.maxAutonomyLevel;
  const maxAutonomyLevel = minAutonomy(requestedAutonomy, parent.maxAutonomyLevel);

  let budget = input.budget ?? parent.budget;
  if (parent.budget !== undefined) {
    budget = budget === undefined ? parent.budget : Math.min(budget, parent.budget);
  }

  // Company scope: inherit the parent's when it is set; otherwise a child may
  // narrow to a specific company.
  const companyId = parent.companyId ?? input.companyId;

  // Lifetime: never outlive the parent.
  let expiresAt = input.expiresAt;
  if (parent.expiresAt) {
    expiresAt =
      expiresAt && expiresAt < parent.expiresAt ? expiresAt : parent.expiresAt;
  }

  return DelegatedAuthority.parse({
    authorityId: input.authorityId ?? newAuthorityId(),
    subject: input.subject,
    principalChain: [...parent.principalChain, input.subject],
    parentAuthorityId: parent.authorityId,
    tenantId: parent.tenantId,
    ...(companyId ? { companyId } : {}),
    capabilities,
    tools,
    dataScopes,
    maxRiskLevel,
    maxAutonomyLevel,
    ...(budget !== undefined ? { budget } : {}),
    ...(input.provenanceId ? { provenanceId: input.provenanceId } : {}),
    status: 'active',
    grantReason: input.grantReason,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(expiresAt ? { expiresAt } : {}),
    metadata: input.metadata ?? {},
  });
}

export interface CreateRootAuthorityInput {
  subject: Principal;
  tenantId: string;
  grantReason: string;
  companyId?: string;
  capabilities?: Capability[];
  tools?: ToolId[];
  dataScopes?: string[];
  maxRiskLevel?: RiskLevel;
  maxAutonomyLevel?: AutonomyLevel;
  budget?: number;
  provenanceId?: ProvenanceId;
  expiresAt?: string;
  authorityId?: AuthorityId;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a root authority — the top of a delegation tree, held directly by a
 * human or operator principal. Root authority has no parent, so it defines the
 * ceiling every descendant is attenuated from.
 */
export function createRootAuthority(
  input: CreateRootAuthorityInput,
): DelegatedAuthority {
  return DelegatedAuthority.parse({
    authorityId: input.authorityId ?? newAuthorityId(),
    subject: input.subject,
    principalChain: [input.subject],
    tenantId: input.tenantId,
    ...(input.companyId ? { companyId: input.companyId } : {}),
    capabilities: input.capabilities ?? [],
    tools: input.tools ?? [],
    dataScopes: input.dataScopes ?? [],
    maxRiskLevel: input.maxRiskLevel ?? 'R1',
    maxAutonomyLevel: input.maxAutonomyLevel ?? 'L1',
    ...(input.budget !== undefined ? { budget: input.budget } : {}),
    ...(input.provenanceId ? { provenanceId: input.provenanceId } : {}),
    status: 'active',
    grantReason: input.grantReason,
    createdAt: input.createdAt ?? new Date().toISOString(),
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    metadata: input.metadata ?? {},
  });
}

/** True when the authority is active and not past its expiry at `now`. */
export function authorityIsActive(
  authority: DelegatedAuthority,
  now: string,
): boolean {
  if (authority.status !== 'active') return false;
  if (authority.expiresAt && authority.expiresAt < now) return false;
  return true;
}

/** True when this authority actually delegates the given capability. */
export function authorityGrantsCapability(
  authority: DelegatedAuthority,
  capability: Capability,
): boolean {
  return authority.capabilities.map(String).includes(String(capability));
}

/** True when `risk` is within this authority's risk ceiling. */
export function authorityAllowsRisk(
  authority: DelegatedAuthority,
  risk: RiskLevel,
): boolean {
  return !riskGreaterThan(risk, authority.maxRiskLevel);
}

/**
 * The effective risk ceiling across a delegation chain — the lowest ceiling any
 * link imposes. Useful when reconstructing effective authority from a chain of
 * authorities rather than a single attenuated record.
 */
export function effectiveRiskCeiling(
  chain: readonly DelegatedAuthority[],
): RiskLevel {
  // The most restrictive (lowest) ceiling wins; start high and lower it.
  return chain.reduce<RiskLevel>((acc, a) => {
    // maxRisk returns the higher of two; the effective ceiling is the lower,
    // so pick the one that is NOT the max (unless they are equal).
    return maxRisk(acc, a.maxRiskLevel) === acc ? a.maxRiskLevel : acc;
  }, 'R3');
}
