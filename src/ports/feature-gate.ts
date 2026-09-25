/**
 * FeatureGate port.
 *
 * A feature gate answers "is this capability/agent switched on right now?" — a
 * rollout control and kill-switch, evaluated as an INPUT to orchestration and
 * the Execution Gateway. It is deliberately NOT part of the authority boundary:
 * a gate can *withhold* work (a kill-switch), but it can never *grant* it. The
 * PolicyEngine / Execution Gateway remain the sole authority (ADR-008), and a
 * flag provider (PostHog per ADR-010, or anything else) sits behind this port —
 * Core never depends on the vendor.
 *
 * Fail-open by design: because the gate is not the authority and an analytics /
 * flag backend is not a safety-critical dependency, when the gate cannot answer
 * it defers to a caller-supplied default (typically "enabled"), so a flag
 * outage never halts governed work. Denial of unsafe work is the authority
 * layer's job, not the gate's.
 */
export interface FeatureGateContext {
  /** Attributable actor (actorId or agentUri) for targeting. */
  actorId?: string;
  agentUri?: string;
  /** Scope for tenant/company targeting. Never carries PII. */
  tenantId?: string;
  companyId?: string;
  /** Capability the gate is being consulted about, when relevant. */
  capability?: string;
  /** Extra non-PII targeting attributes. */
  attributes?: Record<string, string | number | boolean>;
}

export interface FeatureGate {
  /**
   * Whether `flag` is enabled for this context. May be sync or async (a remote
   * provider). Implementations must not throw for an unknown flag — return the
   * provider's default; callers apply their own fallback via {@link resolveEnabled}.
   */
  isEnabled(flag: string, context?: FeatureGateContext): boolean | Promise<boolean>;

  /**
   * The active variant of a multivariate flag, or undefined when the flag is
   * off / unknown. Used for staged rollouts, not for experiments (see
   * @aion/decision-engine's ExperimentProvider for calibration experiments).
   */
  variant(
    flag: string,
    context?: FeatureGateContext,
  ): string | undefined | Promise<string | undefined>;
}
