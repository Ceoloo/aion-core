import { z } from 'zod';

/**
 * Risk levels.
 *
 * This taxonomy is taken directly from aion-docs/governance/risk-levels.md and
 * is authoritative. Risk level is the single classification that drives how much
 * control an action requires: whether it can run autonomously, whether it needs
 * a human gate, and how closely it must be observed.
 *
 * NOTE (conflict record): the Phase 1 build prompt suggested a
 * LOW/MEDIUM/HIGH/CRITICAL taxonomy. aion-docs already defines R0–R3, and the
 * prompt instructs us to follow aion-docs on conflict. We therefore implement
 * R0–R3. See docs/phase-1.md for the recorded conflict.
 *
 *  - R0 Trivial   — no meaningful blast radius, easily reversible. Autonomous.
 *  - R1 Low       — minor, reversible, internal scope. Autonomous within policy.
 *  - R2 Moderate  — external or harder-to-reverse. Policy may require a gate.
 *  - R3 High      — financial / destructive / customer-sensitive / production /
 *                   security-sensitive. Human gate required by default.
 */
export const RISK_LEVELS = ['R0', 'R1', 'R2', 'R3'] as const;

export const RiskLevel = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevel>;

/** Numeric ordering so risk levels can be compared and max-ed. */
const RISK_ORDER: Record<RiskLevel, number> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
};

/** Human-readable labels, aligned with aion-docs. */
export const RISK_LABEL: Record<RiskLevel, string> = {
  R0: 'Trivial',
  R1: 'Low',
  R2: 'Moderate',
  R3: 'High',
};

/** Returns the numeric rank of a risk level (higher is riskier). */
export function riskRank(level: RiskLevel): number {
  return RISK_ORDER[level];
}

/** True if `a` is strictly riskier than `b`. */
export function riskGreaterThan(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER[a] > RISK_ORDER[b];
}

/** True if `a` is at least as risky as `b`. */
export function riskAtLeast(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

/**
 * Returns the higher of two risk levels.
 *
 * Central risk classification never *lowers* a declared risk (see
 * aion-docs/governance/risk-levels.md: "Risk is classified centrally, never
 * lowered by the executing worker"), so the control plane always takes the max.
 */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/** The highest risk level in a set, or R0 if the set is empty. */
export function highestRisk(levels: readonly RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((acc, level) => maxRisk(acc, level), 'R0');
}
