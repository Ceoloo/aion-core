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
import type { Actor, AgentActor } from '../contracts/actor.js';
import type { AuthorizationRequest } from '../contracts/scope.js';
import { tenantScopeAllows } from '../contracts/scope.js';
import type { ApprovalRequest } from '../contracts/approval.js';

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
 * Context for {@link PolicyEngine.authorize} (Mission 003).
 *
 * Runtime supplies the *authenticated* actor and any approval record it loaded.
 * Caller-supplied permission claims on the request are evidence only — never
 * authority.
 */
export interface AuthorizeContext {
  /** Authenticated actor established by Runtime (not caller self-assertion). */
  actor: Actor;
  /** Approval loaded by Runtime when request.approvalId is set. */
  approval?: ApprovalRequest;
  /** Catalog service key Runtime resolved for this invocation. */
  resolvedServiceKey?: string;
  /** ISO timestamp override for deterministic tests. */
  now?: string;
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
 * Mission 003 adds {@link authorize} for tenant/identity/approval/budget
 * isolation. Runtime decides ALLOW / DENY / REQUIRE_APPROVAL — agents never
 * self-assert authority.
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

    const actorDefaultRisk =
      actor.actorType === 'agent' ? actor.defaultRiskLevel : undefined;
    const classification = this.risk.classify({
      capability: command.capability,
      ...(command.riskLevel ? { declaredRisk: command.riskLevel } : {}),
      ...(actorDefaultRisk ? { actorDefaultRisk } : {}),
    });
    const riskLevel = classification.riskLevel;

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

  /**
   * Mission 003 authorization boundary.
   *
   * Runtime independently decides ALLOW / DENY / REQUIRE_APPROVAL. Never trusts
   * agent self-claims for identity, tenant, serviceKey, or approval binding.
   */
  authorize(
    request: AuthorizationRequest,
    ctx: AuthorizeContext,
  ): PolicyDecision {
    const { actor } = ctx;
    const checks: PolicyCheck[] = [];
    const now = ctx.now ?? this.clock.isoNow();
    const riskLevel: RiskLevel = request.riskLevel ?? 'R1';
    const capability = (request.capability ??
      request.serviceKey ??
      request.action) as Capability;

    // 1. Tenant scope — fail closed.
    const actorTenant =
      actor.actorType === 'agent' ? actor.tenantId : request.tenantId;
    const tenantOk =
      Boolean(actorTenant) &&
      actorTenant === request.tenantId &&
      tenantScopeAllows(actorTenant, request.resourceTenantId);
    checks.push({
      kind: 'tenant-scope',
      passed: tenantOk,
      detail: tenantOk
        ? `tenant scope ok (${request.tenantId})`
        : `tenant scope denied (actor=${actorTenant ?? 'none'} request=${request.tenantId} resource=${request.resourceTenantId ?? 'n/a'})`,
    });
    if (!tenantOk) {
      return this.deny(
        `tenant isolation denied: actor tenant "${actorTenant ?? 'none'}" cannot act in tenant "${request.tenantId}"` +
          (request.resourceTenantId
            ? ` against resource tenant "${request.resourceTenantId}"`
            : ''),
        riskLevel,
        checks,
      );
    }

    // 2. Identity — authenticated actor wins over claimed agentId/agentUri.
    let identityOk = true;
    let identityDetail = 'identity ok';
    if (actor.actorType === 'agent') {
      const agent = actor as AgentActor;
      if (request.agentId !== agent.agentId && request.agentId !== agent.actorId) {
        identityOk = false;
        identityDetail = `identity spoof denied: claimed ${request.agentId} != authenticated ${agent.agentId}`;
      } else if (
        request.agentUri &&
        agent.agentUri &&
        request.agentUri !== agent.agentUri
      ) {
        identityOk = false;
        identityDetail = `agentUri spoof denied: claimed ${request.agentUri} != authenticated ${agent.agentUri}`;
      }
    } else if (request.agentId !== actor.actorId) {
      identityOk = false;
      identityDetail = `identity spoof denied: claimed ${request.agentId} != authenticated ${actor.actorId}`;
    }
    checks.push({ kind: 'identity', passed: identityOk, detail: identityDetail });
    if (!identityOk) {
      return this.deny(identityDetail, riskLevel, checks);
    }

    // 3. Permission — from authenticated actor, never from request.permissions.
    const perm = this.permissions.evaluateCapability(actor, capability);
    checks.push({
      kind: 'permission',
      passed: perm.permitted,
      detail: perm.reason,
    });
    if (!perm.permitted) {
      return this.deny(perm.reason, riskLevel, checks);
    }

    // 3b. serviceKey tampering — claimed key must match Runtime-resolved key.
    if (
      request.serviceKey &&
      ctx.resolvedServiceKey &&
      request.serviceKey !== ctx.resolvedServiceKey
    ) {
      const detail = `serviceKey tampering denied: claimed ${request.serviceKey} != resolved ${ctx.resolvedServiceKey}`;
      checks.push({ kind: 'permission', passed: false, detail });
      return this.deny(detail, riskLevel, checks);
    }

    // 4. Risk allowance.
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

    // 5. Approval binding (cross-execution / replay / expiry / missing).
    const needsApproval =
      this.requiresApproval(riskLevel, capability) ||
      request.action === 'execute' && riskLevel === 'R2';
    if (needsApproval || request.approvalId || ctx.approval) {
      const binding = this.evaluateApprovalBinding(request, ctx, now);
      checks.push({
        kind: 'approval-binding',
        passed: binding.passed,
        detail: binding.detail,
      });
      if (!binding.passed) {
        // Missing approval on a gated action → REQUIRE_APPROVAL; bad binding → DENY.
        if (binding.missing) {
          checks.push({
            kind: 'approval-requirement',
            passed: false,
            detail: `risk ${riskLevel} requires a human gate`,
          });
          return {
            decision: 'REQUIRE_APPROVAL',
            reason: this.approvalReason(riskLevel, capability),
            policyId: this.policyId,
            riskLevel,
            requiresApproval: true,
            checks,
            evaluatedAt: this.clock.isoNow(),
          };
        }
        return this.deny(binding.detail, riskLevel, checks);
      }
    } else {
      checks.push({
        kind: 'approval-binding',
        passed: true,
        detail: 'no approval required for this action',
      });
    }

    // 6. Budget.
    const budgetRemaining =
      request.budgetRemaining ??
      (actor.actorType === 'agent' ? actor.costBudget : undefined);
    if (
      budgetRemaining !== undefined &&
      request.estimatedCost !== undefined &&
      request.estimatedCost > budgetRemaining
    ) {
      const detail = `budget exceeded: estimated ${request.estimatedCost} > remaining ${budgetRemaining}`;
      checks.push({ kind: 'budget', passed: false, detail });
      // Over budget on R2+ asks for approval; hard exceed on execute is DENY.
      if (riskLevel === 'R0' || riskLevel === 'R1') {
        return this.deny(detail, riskLevel, checks);
      }
      checks.push({
        kind: 'approval-requirement',
        passed: false,
        detail: 'budget overrun requires approval',
      });
      return {
        decision: 'REQUIRE_APPROVAL',
        reason: detail,
        policyId: this.policyId,
        riskLevel,
        requiresApproval: true,
        checks,
        evaluatedAt: this.clock.isoNow(),
      };
    }
    checks.push({
      kind: 'budget',
      passed: true,
      detail:
        budgetRemaining === undefined
          ? 'no budget ceiling configured'
          : `budget ok (remaining ${budgetRemaining})`,
    });

    // 7. Approval requirement (when not already cleared by a bound approval).
    const alreadyCleared = Boolean(
      request.approvalId &&
        ctx.approval &&
        ctx.approval.status === 'granted' &&
        !ctx.approval.consumedAt,
    );
    const requiresApproval =
      !alreadyCleared && this.requiresApproval(riskLevel, capability);
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
        reason: this.approvalReason(riskLevel, capability),
        policyId: this.policyId,
        riskLevel,
        requiresApproval: true,
        checks,
        evaluatedAt: this.clock.isoNow(),
      };
    }

    return {
      decision: 'ALLOW',
      reason: `authorization passed at risk ${riskLevel}`,
      policyId: this.policyId,
      riskLevel,
      requiresApproval: false,
      checks,
      evaluatedAt: this.clock.isoNow(),
    };
  }

  private evaluateApprovalBinding(
    request: AuthorizationRequest,
    ctx: AuthorizeContext,
    now: string,
  ): { passed: boolean; detail: string; missing?: boolean } {
    if (!request.approvalId) {
      return {
        passed: false,
        missing: true,
        detail: 'approvalId required for gated execute',
      };
    }
    const approval = ctx.approval;
    if (!approval) {
      return {
        passed: false,
        detail: `approval ${request.approvalId} not found`,
      };
    }
    if (approval.approvalId !== request.approvalId) {
      return {
        passed: false,
        detail: 'approvalId mismatch with loaded approval',
      };
    }
    if (approval.status !== 'granted') {
      return {
        passed: false,
        detail: `approval ${approval.approvalId} is ${approval.status}, not granted`,
      };
    }
    if (approval.consumedAt) {
      return {
        passed: false,
        detail: `approval ${approval.approvalId} already consumed (replay denied)`,
      };
    }
    if (approval.expiresAt && approval.expiresAt < now) {
      return {
        passed: false,
        detail: `approval ${approval.approvalId} expired at ${approval.expiresAt}`,
      };
    }
    if (approval.tenantId && approval.tenantId !== request.tenantId) {
      return {
        passed: false,
        detail: `approval tenant ${approval.tenantId} != request tenant ${request.tenantId}`,
      };
    }
    const boundExecution =
      approval.executionId ?? request.approvalExecutionId;
    const target =
      request.targetExecutionId ?? request.approvalExecutionId;
    if (boundExecution && target && boundExecution !== target) {
      return {
        passed: false,
        detail: `approval bound to execution ${boundExecution} cannot authorize execution ${target}`,
      };
    }
    return {
      passed: true,
      detail: `approval ${approval.approvalId} bound and valid`,
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
