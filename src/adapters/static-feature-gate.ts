import type { FeatureGate, FeatureGateContext } from '../ports/feature-gate.js';

/**
 * Deterministic, dependency-free {@link FeatureGate}. Usable now (config- or
 * env-driven kill-switches) with no external provider; a PostHog-backed gate
 * (ADR-010) implements the same port and is injected at the composition root.
 *
 * Flags may be set globally, or per-context key (tenant / agent) for a targeted
 * override. Lookup order for `isEnabled(flag, ctx)`:
 *   1. exact override for `flag@<scopeKey>` (most specific);
 *   2. global value for `flag`;
 *   3. the gate's `defaultEnabled` (fail-open, default true).
 */
export interface StaticFeatureGateConfig {
  /** flag -> enabled (global). */
  flags?: Record<string, boolean>;
  /** flag -> variant (global). */
  variants?: Record<string, string>;
  /** "flag@scopeKey" -> enabled (targeted override; see scopeKeysFor). */
  overrides?: Record<string, boolean>;
  /** Value returned when a flag is not configured anywhere. Default true. */
  defaultEnabled?: boolean;
}

/** Scope keys a context can match, most-specific first. */
function scopeKeysFor(context?: FeatureGateContext): string[] {
  if (!context) return [];
  const keys: string[] = [];
  if (context.agentUri) keys.push(`agent:${context.agentUri}`);
  if (context.actorId) keys.push(`actor:${context.actorId}`);
  if (context.companyId) keys.push(`company:${context.companyId}`);
  if (context.tenantId) keys.push(`tenant:${context.tenantId}`);
  return keys;
}

export class StaticFeatureGate implements FeatureGate {
  private readonly flags: Record<string, boolean>;
  private readonly variants: Record<string, string>;
  private readonly overrides: Record<string, boolean>;
  private readonly defaultEnabled: boolean;

  constructor(config: StaticFeatureGateConfig = {}) {
    this.flags = config.flags ?? {};
    this.variants = config.variants ?? {};
    this.overrides = config.overrides ?? {};
    this.defaultEnabled = config.defaultEnabled ?? true;
  }

  isEnabled(flag: string, context?: FeatureGateContext): boolean {
    for (const scope of scopeKeysFor(context)) {
      const key = `${flag}@${scope}`;
      if (key in this.overrides) return this.overrides[key]!;
    }
    if (flag in this.flags) return this.flags[flag]!;
    return this.defaultEnabled;
  }

  variant(flag: string): string | undefined {
    return this.variants[flag];
  }
}

/**
 * A gate that always returns `enabled` (fail-open) — the safe default when no
 * flag backend is configured, since the gate is not the authority.
 */
export const alwaysEnabledFeatureGate: FeatureGate = new StaticFeatureGate({
  defaultEnabled: true,
});

/**
 * Resolve a possibly-async gate answer with an explicit fallback, never
 * throwing. Callers in a hot path use this so a provider error/timeout defers
 * to `fallback` (fail-open for a kill-switch) rather than blocking work.
 */
export async function resolveEnabled(
  gate: FeatureGate,
  flag: string,
  context?: FeatureGateContext,
  fallback = true,
): Promise<boolean> {
  try {
    return await gate.isEnabled(flag, context);
  } catch {
    return fallback;
  }
}

/** Canonical kill-switch flag key for an agent domain, e.g. "agent.revenue.enabled". */
export function agentEnabledFlag(domain: string): string {
  return `agent.${domain}.enabled`;
}

/**
 * Whether an agent domain is switched on. Fail-open: a gate error defers to
 * enabled, because withholding governed work is the authority layer's job, not
 * the gate's. Pair this pre-dispatch in the orchestrator/gateway; a `false`
 * result means "do not dispatch — kill-switched", it never means "authorized".
 */
export async function isAgentEnabled(
  gate: FeatureGate,
  domain: string,
  context?: FeatureGateContext,
): Promise<boolean> {
  return resolveEnabled(gate, agentEnabledFlag(domain), context, true);
}
