import { z } from 'zod';
import { RiskLevel } from './risk.js';

/**
 * Policy contract.
 *
 * The policy engine returns a structured, observable decision — never a bare
 * boolean. Three outcomes are possible
 * (aion-docs/architecture/control-plane.md, governance/permissions.md):
 *
 *  - ALLOW            — permitted and cleared to proceed now.
 *  - DENY             — not permitted (or exceeds risk allowance / forbidden).
 *  - REQUIRE_APPROVAL — permitted, but a human gate must clear it first.
 *
 * Every decision carries its reason, the policy that produced it, the centrally
 * classified risk level, and the individual checks that led to it, so policy
 * evaluation is itself fully traceable.
 */
export const POLICY_DECISIONS = ['ALLOW', 'DENY', 'REQUIRE_APPROVAL'] as const;
export const PolicyDecisionKind = z.enum(POLICY_DECISIONS);
export type PolicyDecisionKind = z.infer<typeof PolicyDecisionKind>;

/** The kinds of check the policy engine performs, in evaluation order. */
export const POLICY_CHECK_KINDS = [
  'tenant-scope',
  'identity',
  'permission',
  'data-scope',
  'tool',
  'risk-allowance',
  'approval-binding',
  'budget',
  'approval-requirement',
  'autonomy-grant',
] as const;
export const PolicyCheckKind = z.enum(POLICY_CHECK_KINDS);
export type PolicyCheckKind = z.infer<typeof PolicyCheckKind>;

/** One sub-decision within a policy evaluation, recorded for observability. */
export const PolicyCheck = z.object({
  kind: PolicyCheckKind,
  passed: z.boolean(),
  detail: z.string(),
});
export type PolicyCheck = z.infer<typeof PolicyCheck>;

export const PolicyDecision = z.object({
  decision: PolicyDecisionKind,
  reason: z.string(),
  /** Identifier of the policy/ruleset that produced this decision. */
  policyId: z.string(),
  /** The centrally classified risk level of the action. */
  riskLevel: RiskLevel,
  /** True when the decision was REQUIRE_APPROVAL. */
  requiresApproval: z.boolean(),
  /** The ordered checks that produced the decision. */
  checks: z.array(PolicyCheck),
  evaluatedAt: z.string().datetime(),
});
export type PolicyDecision = z.infer<typeof PolicyDecision>;
