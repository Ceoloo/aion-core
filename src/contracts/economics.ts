import { z } from 'zod';
import { MissionId } from './identifiers.js';

/**
 * Mission Economics + Scope Rollups (Mission 005).
 *
 * Aggregate execution truth upward:
 *
 *   Execution → Mission → Project / Venture → Company → Holding (tenant)
 *
 * Core owns the contract shapes. aion-data derives values via SQL rollup over
 * durable executions / approvals / outcomes — not a second ledger. Holding is
 * the tenant/portfolio aggregate; no separate Holding table in MVP.
 */

/** Optional hierarchy dims used when rolling up by scope (not mission). */
export const EconomicsScopeDims = z.object({
  /** Tenant / holding portfolio — required for scope rollups. */
  tenantId: z.string().min(1),
  companyId: z.string().min(1).optional(),
  ventureId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});
export type EconomicsScopeDims = z.infer<typeof EconomicsScopeDims>;

/**
 * Shared economics metrics derived from durable execution truth.
 *
 * - totalCostUnits: Σ (cost.units) across executions
 * - attributedEconomicValue: Σ revenue_attributed (+ realized outcome value)
 * - roi: EV / cost (null when cost is zero — avoid Infinity)
 * - humanInterventions: approvals with a human decision (granted|rejected)
 * - policyDenials: executions with status `denied`
 */
export const EconomicsMetrics = z.object({
  totalExecutions: z.number().int().nonnegative(),
  successCount: z.number().int().nonnegative(),
  failureCount: z.number().int().nonnegative(),
  /** Executions stopped by policy DENY. */
  policyDenials: z.number().int().nonnegative(),
  /** Approval records associated with the rollup scope (any status). */
  approvals: z.number().int().nonnegative(),
  /** Approvals that a human decided (granted or rejected). */
  humanInterventions: z.number().int().nonnegative(),
  /** Σ abstract cost units from ExecutionObject.cost.units. */
  totalCostUnits: z.number().nonnegative(),
  /** Σ duration ms derived from started_at/completed_at when both present. */
  totalDurationMs: z.number().nonnegative(),
  /** Count of durable outcome rows in scope. */
  outcomeCount: z.number().int().nonnegative(),
  /**
   * Attributed economic value: Σ executions.revenue_attributed plus Σ realized
   * outcomes.value (when present). Vendor-neutral abstract units until a
   * pricing ledger lands.
   */
  attributedEconomicValue: z.number(),
  /**
   * ROI / EV-to-cost = attributedEconomicValue / totalCostUnits.
   * Null when totalCostUnits is 0.
   */
  roi: z.number().nullable(),
  /** When this rollup was computed (UTC ISO-8601). */
  computedAt: z.string().datetime(),
});
export type EconomicsMetrics = z.infer<typeof EconomicsMetrics>;

/** Mission-level economics rollup — primary Mission 005 surface. */
export const MissionEconomicsRollup = EconomicsMetrics.extend({
  missionId: MissionId,
  /** Tenant slice applied when the caller scoped the rollup (optional). */
  tenantId: z.string().min(1).optional(),
});
export type MissionEconomicsRollup = z.infer<typeof MissionEconomicsRollup>;

/**
 * Scope economics rollup — project / venture / company / holding (tenant).
 * Holding = tenant aggregate without a dedicated Holding table.
 */
export const ScopeEconomicsRollup = EconomicsMetrics.extend({
  scope: EconomicsScopeDims,
});
export type ScopeEconomicsRollup = z.infer<typeof ScopeEconomicsRollup>;

/**
 * Compute ROI / EV-to-cost. Returns null when cost is zero so callers never
 * materialize Infinity in JSON.
 */
export function computeRoi(
  attributedEconomicValue: number,
  totalCostUnits: number,
): number | null {
  if (totalCostUnits <= 0) return null;
  return attributedEconomicValue / totalCostUnits;
}
