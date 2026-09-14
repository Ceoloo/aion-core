import { z } from 'zod';
import type { AutonomyLevel } from './autonomy.js';

/**
 * Product Action Tiers (ADR-007) — packaging vocabulary that projects onto
 * Autonomy L0–L4. Not a second autonomy ladder.
 *
 * Observe ≤ Assist ≤ Execute
 */
export const ACTION_TIERS = ['observe', 'assist', 'execute'] as const;
export const ActionTier = z.enum(ACTION_TIERS);
export type ActionTier = z.infer<typeof ActionTier>;

const TIER_RANK: Record<ActionTier, number> = {
  observe: 0,
  assist: 1,
  execute: 2,
};

/** True when declared tier is at least as powerful as required. */
export function actionTierAllows(
  declared: ActionTier,
  required: ActionTier,
): boolean {
  return TIER_RANK[declared] >= TIER_RANK[required];
}

/**
 * Map AutonomyLevel ceiling → default Action Tier.
 * L0 Observe, L1 Assist (Recommend), L2–L4 Execute.
 */
export function actionTierFromAutonomy(level: AutonomyLevel): ActionTier {
  if (level === 'L0') return 'observe';
  if (level === 'L1') return 'assist';
  return 'execute';
}

const OBSERVE_SUFFIX =
  /\.(read|search|analyze|get|list|lookup|inspect|summarize|research|summary)$/i;
const ASSIST_SUFFIX =
  /\.(draft|recommend|prepare|suggest|propose|plan)$/i;
const EXECUTE_SUFFIX =
  /\.(write|update|create|delete|schedule|send|execute|post|pay|deploy|void|refund|trigger|mutate)$/i;

/**
 * Classify a capability into the minimum Action Tier required.
 * Unknown shapes fail closed as Execute (Observe/Assist must not assume safe).
 */
export function requiredActionTierForCapability(capability: string): ActionTier {
  const cap = capability.trim();
  if (EXECUTE_SUFFIX.test(cap)) return 'execute';
  if (ASSIST_SUFFIX.test(cap)) return 'assist';
  if (OBSERVE_SUFFIX.test(cap)) return 'observe';
  return 'execute';
}

export type ActionTierConsistency = {
  ok: boolean;
  detail: string;
};

/**
 * Grants must not exceed the declared Action Tier (registration fail-closed).
 */
export function assertActionTierConsistentWithGrants(input: {
  actionTier: ActionTier;
  permissions: readonly string[];
}): ActionTierConsistency {
  const offenders = input.permissions.filter(
    (p) => !actionTierAllows(input.actionTier, requiredActionTierForCapability(p)),
  );
  if (offenders.length === 0) {
    return {
      ok: true,
      detail: `action tier ${input.actionTier} consistent with grants`,
    };
  }
  return {
    ok: false,
    detail: `action tier ${input.actionTier} inconsistent with execute/assist grants: [${offenders.join(', ')}]`,
  };
}
