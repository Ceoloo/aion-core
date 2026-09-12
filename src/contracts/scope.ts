import { z } from 'zod';
import { ExecutionId, MissionId } from './identifiers.js';
import { RiskLevel } from './risk.js';

/**
 * Execution scope — Mission 003 tenant / domain isolation.
 *
 * Hierarchy (all levels optional except tenant):
 *
 *   tenant (REQUIRED)
 *     └── company (optional)
 *           └── venture (optional)
 *                 └── project (optional)
 *                       └── mission (optional)
 *                             └── execution
 *
 * An execution may carry only `tenantId`. Deeper levels exist when the
 * workload needs them — the hierarchy must not become ceremony.
 *
 * Runtime authorizes against scope. Actors do not self-assert cross-tenant
 * authority. "The agent says it has permission" is never sufficient.
 */

export const ExecutionScope = z.object({
  /** Owning tenant — required for every governed execution. */
  tenantId: z.string().min(1),
  companyId: z.string().min(1).optional(),
  ventureId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  /** Business-intent mission this execution serves (optional). */
  missionId: MissionId.optional(),
});
export type ExecutionScope = z.infer<typeof ExecutionScope>;

/**
 * Lineage links for reconstructing orchestrated work without requiring a full
 * orchestrator yet (Mission 004 precursor).
 */
export const ExecutionLineage = z.object({
  /** Immediate parent execution, if this is a child worker. */
  parentExecutionId: ExecutionId.optional(),
  /** Root of the execution tree (defaults to self when omitted at create). */
  rootExecutionId: ExecutionId.optional(),
  missionId: MissionId.optional(),
});
export type ExecutionLineage = z.infer<typeof ExecutionLineage>;

/**
 * Authorization request presented to Runtime (Mission 003).
 *
 * Runtime independently decides ALLOW / DENY / REQUIRE_APPROVAL from these
 * fields. Caller-supplied permission claims are evidence, not authority.
 */
export const AuthorizationRequest = z.object({
  /** WHO — attributable agent / actor identity. */
  agentId: z.string().min(1),
  agentUri: z.string().min(1).optional(),
  /** WHERE — scope. */
  tenantId: z.string().min(1),
  companyId: z.string().min(1).optional(),
  environment: z.string().min(1).default('staging'),
  /** WHAT — catalog service / capability. */
  serviceKey: z.string().min(1).optional(),
  capability: z.string().min(1).optional(),
  /** WHY — mission / objective reference. */
  missionId: MissionId.optional(),
  objective: z.string().min(1).optional(),
  /** AUTHORITY — declared grants (evaluated, never trusted blindly). */
  role: z.string().min(1).optional(),
  permissions: z.array(z.string()).default([]),
  autonomyLevel: z.string().min(1).optional(),
  budgetRemaining: z.number().nonnegative().optional(),
  /** REQUEST — action + target resources. */
  action: z.string().min(1),
  resourceTenantId: z.string().min(1).optional(),
  resourceRefs: z.array(z.string()).default([]),
  /** Data classes touched by this request (matched against AgentActor.allowedData). */
  resourceDataClasses: z.array(z.string()).default([]),
  approvalId: z.string().min(1).optional(),
  /** Bound execution this approval was issued for (replay / cross-bind defense). */
  approvalExecutionId: ExecutionId.optional(),
  targetExecutionId: ExecutionId.optional(),
  /** Estimated cost of this request (budget enforcement). */
  estimatedCost: z.number().nonnegative().optional(),
  /** Caller-declared or catalog risk; Runtime classifies / may raise. */
  riskLevel: RiskLevel.optional(),
});
export type AuthorizationRequest = z.infer<typeof AuthorizationRequest>;

/**
 * True when actor scope may access a resource in `resourceTenantId`.
 * Missing actor tenant always fails closed.
 */
export function tenantScopeAllows(
  actorTenantId: string | undefined,
  resourceTenantId: string | undefined,
): boolean {
  if (!actorTenantId) return false;
  if (!resourceTenantId) return true; // no resource tenant claimed — other checks apply
  return actorTenantId === resourceTenantId;
}
