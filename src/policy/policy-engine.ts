import type { Command } from '../contracts/command.js';
import type { Capability } from '../contracts/capability.js';
import type {
  PolicyDecision,
  PolicyCheck,
} from '../contracts/policy.js';
import type { RiskLevel } from '../contracts/risk.js';
import { riskGreaterThan } from '../contracts/risk.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { RiskEvaluator, type RiskEvaluatorConfig } from './risk-evaluator.js';

export interface PolicyEngineConfig {
  /** Identifier recorded on every decision this engine produces. */
  policyId?: string;
  /** Risk classification configuration (used to build a default evaluator). */
  risk?: RiskEvaluatorConfig;
  /**
   * Capabilities that require a human gate at R2 (Moderate). R3 (High) always
   * requires a gate, per aion-docs/governance/risk-levels.md.
   */
  gatedCapabilities?: Capability[];
  /** If true, every R2 action requires a human gate. Default: false. */
  gateAllModerate?: boolean;
}

/**
 * PolicyEngine.
 *
 * The small, deterministic decision layer of the control plane. It composes a
 * {@link PermissionEvaluator} and {@link RiskEvaluator} into a single
 * structured {@link PolicyDecision}: ALLOW, DENY, or REQUIRE_APPROVAL, with a
 * reason, the classified risk level, and the ordered checks that produced it.
 *
 * Evaluation order (aion-docs/governance/permissions.md, risk-levels.md,
 * human-gates.md):
 *   1. permission — is the actor granted this capability (and not forbidden)?
 *   2. tool — if a tool is targeted, is the actor allowed to use it?
 *   3. risk allowance — does the classified risk exceed the actor's ceiling?
 *   4. approval requirement — does risk/policy demand a human gate?
 *
 * Being permitted is not the same as being cleared: a permitted high-risk
 * action still routes through the gate.
 */
export class PolicyEngine {
  private readonly policyId: string;
  private readonly gatedCapabilities: Set<string>;
  private readonly gateAllModerate: boolean;
  private readonly permissions: PermissionEvaluator;
  private readonly risk: RiskEvaluator;
  private readonly clock: Clock;

  constructor(
    config: PolicyEngineConfig = {},
    deps: {
      permissions?: PermissionEvaluator;
      risk?: RiskEvaluator;
      clock?: Clock;
    } = {},
  ) {
    this.policyId = config.policyId ?? 'phase1.default-policy';
    this.gatedCapabilities = new Set(config.gatedCapabilities ?? []);
    this.gateAllModerate = config.gateAllModerate ?? false;
    this.permissions = deps.permissions ?? new PermissionEvaluator();
    this.risk = deps.risk ?? new RiskEvaluator(config.risk);
    this.clock = deps.clock ?? systemClock;
  }

  evaluate(command: Command): PolicyDecision {
    const { actor } = command;
    const checks: PolicyCheck[] = [];

    // Classify risk centrally up-front so every decision carries a risk level.
    const actorDefaultRisk =
      actor.actorType === 'agent' ? actor.defaultRiskLevel : undefined;
    const classification = this.risk.classify({
      capability: command.capability,
      ...(command.riskLevel ? { declaredRisk: command.riskLevel } : {}),
      ...(actorDefaultRisk ? { actorDefaultRisk } : {}),
    });
    const riskLevel = classification.riskLevel;

    // 1. Permission check.
    const perm = this.permissions.evaluateCapability(
      actor,
      command.capability,
    );
    checks.push({
      kind: 'permission',
      passed: perm.permitted,
      detail: perm.reason,
    });
    if (!perm.permitted) {
      return this.deny(perm.reason, riskLevel, checks);
    }

    // 2. Tool check (only when the command targets a specific tool).
    if (command.toolId) {
      const toolCheck = this.permissions.evaluateTool(actor, command.toolId);
      checks.push({
        kind: 'tool',
        passed: toolCheck.permitted,
        detail: toolCheck.reason,
      });
      if (!toolCheck.permitted) {
        return this.deny(toolCheck.reason, riskLevel, checks);
      }
    }

    // 3. Risk-allowance check — permitted is not the same as cleared.
    const exceedsAllowance = riskGreaterThan(riskLevel, actor.maxRiskLevel);
    checks.push({
      kind: 'risk-allowance',
      passed: !exceedsAllowance,
      detail: exceedsAllowance
        ? `action risk ${riskLevel} exceeds actor ceiling ${actor.maxRiskLevel}`
        : `action risk ${riskLevel} within actor ceiling ${actor.maxRiskLevel}`,
    });
    if (exceedsAllowance) {
      return this.deny(
        `action risk ${riskLevel} exceeds actor "${actor.name}" ceiling ${actor.maxRiskLevel}`,
        riskLevel,
        checks,
      );
    }

    // 4. Approval requirement — R3 always gates; R2 gates per policy.
    const requiresApproval = this.requiresApproval(riskLevel, command.capability);
    checks.push({
      kind: 'approval-requirement',
      passed: !requiresApproval,
      detail: requiresApproval
        ? `risk ${riskLevel} requires a human gate`
        : `risk ${riskLevel} does not require a human gate`,
    });
    if (requiresApproval) {
      return {
        decision: 'REQUIRE_APPROVAL',
        reason: this.approvalReason(riskLevel, command.capability),
        policyId: this.policyId,
        riskLevel,
        requiresApproval: true,
        checks,
        evaluatedAt: this.clock.isoNow(),
      };
    }

    return {
      decision: 'ALLOW',
      reason: `permitted and cleared at risk ${riskLevel}`,
      policyId: this.policyId,
      riskLevel,
      requiresApproval: false,
      checks,
      evaluatedAt: this.clock.isoNow(),
    };
  }

  private requiresApproval(
    riskLevel: RiskLevel,
    capability: Capability,
  ): boolean {
    if (riskLevel === 'R3') return true;
    if (riskLevel === 'R2') {
      return this.gateAllModerate || this.gatedCapabilities.has(capability);
    }
    return false;
  }

  private approvalReason(riskLevel: RiskLevel, capability: Capability): string {
    if (riskLevel === 'R3') {
      return `high-risk action (R3) requires human approval: "${capability}"`;
    }
    return `moderate-risk action (R2) requires human approval by policy: "${capability}"`;
  }

  private deny(
    reason: string,
    riskLevel: RiskLevel,
    checks: PolicyCheck[],
  ): PolicyDecision {
    return {
      decision: 'DENY',
      reason,
      policyId: this.policyId,
      riskLevel,
      requiresApproval: false,
      checks,
      evaluatedAt: this.clock.isoNow(),
    };
  }
}
