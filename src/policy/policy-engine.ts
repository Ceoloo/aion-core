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
import type { AutonomyGrant } from '../contracts/autonomy-grant.js';
import { evaluateAutonomy } from '../contracts/autonomy-grant.js';
import type { DelegatedAuthority } from '../contracts/authority.js';
import {
  authoritySubsumes,
  authorityIsActive,
  authorityGrantsCapability,
  authorityAllowsRisk,
  principalChainContinues,
} from '../contracts/authority.js';
import type { Provenance } from '../contracts/provenance.js';
import {
  provenanceBacksRisk,
  isQuarantined,
  mayActAsInstruction,
} from '../contracts/provenance.js';
import {
  actionTierAllows,
  actionTierFromAutonomy,
  requiredActionTierForCapability,
  type ActionTier,
} from '../contracts/action-tier.js';

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
  /**
   * Mission 008 — active AutonomyGrant for agent × service × tenant × env.
   * Performance can waive R2 gates only when grant currentLevel is L4.
   * Never waives R3.
   */
  autonomyGrant?: AutonomyGrant;
  /** Mission 008 — force demotion for this decision (manual override). */
  manualAutonomyDemote?: boolean;
  /**
   * The authority actually delegated to the actor for this execution (Sep 2026
   * governance brief). Narrower than the actor's static grant: the requested
   * capability and risk must fall within it. Optional — omitted for callers
   * that have not adopted delegated authority yet.
   */
  authority?: DelegatedAuthority;
  /**
   * The parent's authority, when this actor was spawned by another. When
   * present, the engine enforces the invariant `authority(child) ⊆
   * authority(parent)` and denies any amplification.
   */
  parentAuthority?: DelegatedAuthority;
  /**
   * Provenance of the authority / instruction driving this request. A
   * quarantined origin is never usable and an untrusted origin cannot back a
   * consequential (R2+) action — the engine fails closed.
   */
  authorityProvenance?: Provenance;
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
      // Mission 008 — Runtime may attach AutonomyGrant on command.metadata.
      const grantMeta = command.metadata?.['autonomyGrant'];
      const grant =
        grantMeta && typeof grantMeta === 'object'
          ? (grantMeta as AutonomyGrant)
          : undefined;
      const autonomy = evaluateAutonomy({
        grant,
        riskLevel,
        baselineRequiresApproval: true,
        manualDemote: command.metadata?.['manualAutonomyDemote'] === true,
      });
      checks.push({
        kind: 'autonomy-grant',
        passed: autonomy.waivesApproval,
        detail: autonomy.detail,
      });
      if (autonomy.waivesApproval) {
        return {
          decision: 'ALLOW',
          reason: autonomy.reason,
          policyId: this.policyId,
          riskLevel,
          requiresApproval: false,
          checks,
          evaluatedAt: this.clock.isoNow(),
        };
      }
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

    // 2a. Provenance — the authority/instruction driving this request must come
    // from a trustworthy origin. A quarantined origin is never usable (it has
    // not passed activation), and an untrusted origin cannot back a
    // consequential (R2+) action. Fails closed.
    if (ctx.authorityProvenance) {
      const prov = ctx.authorityProvenance;
      const backs = provenanceBacksRisk(prov, riskLevel);
      // Content that steers the request (an instruction) must be explicitly
      // activated: instructionAllowed + a principal origin + >= declared trust.
      // A declared/trusted instruction with instructionAllowed:false stays inert
      // (mayActAsInstruction returns false), no matter what it says.
      const instructionOk =
        prov.subject !== 'instruction' || mayActAsInstruction(prov);
      const passed = backs && instructionOk;
      let detail: string;
      if (passed) {
        detail = `provenance ok (subject=${prov.subject} origin=${prov.origin} trust=${prov.trustLevel})`;
      } else if (!backs && isQuarantined(prov)) {
        detail = `provenance denied: ${prov.subject} ${prov.provenanceId} is quarantined — not activated`;
      } else if (!backs) {
        detail = `provenance denied: ${prov.trustLevel} origin "${prov.origin}" cannot back ${riskLevel} action`;
      } else {
        detail = `provenance denied: instruction ${prov.provenanceId} is not activated (needs instructionAllowed, a principal origin, and >= declared trust)`;
      }
      checks.push({ kind: 'provenance', passed, detail });
      if (!passed) {
        return this.deny(detail, riskLevel, checks);
      }
    }

    // 2b. Authority delegation — the *effective* power delegated for this
    // execution, enforced on top of the actor's static grant. Two invariants:
    //   (i)  the requested capability + risk must fall within the delegated
    //        authority (a worker cannot use power it was not handed);
    //   (ii) authority(child) ⊆ authority(parent) when a parent is supplied
    //        (delegation may only attenuate — never amplify).
    if (ctx.authority) {
      const authority = ctx.authority;
      const problems: string[] = [];

      if (!authorityIsActive(authority, now)) {
        problems.push(
          `authority ${authority.authorityId} is not active (status=${authority.status})`,
        );
      }

      // The delegated authority must belong to the authenticated actor — an
      // authority issued to another principal (even in the same tenant, even
      // for a shared capability) can never authorize this actor.
      const actorRefs = new Set<string>([actor.actorId]);
      if (actor.actorType === 'agent') {
        const agent = actor as AgentActor;
        actorRefs.add(agent.agentId);
        if (agent.agentUri) actorRefs.add(agent.agentUri);
      }
      if (!actorRefs.has(authority.subject.ref)) {
        problems.push(
          `authority subject "${authority.subject.ref}" is not the authenticated actor "${actor.actorId}"`,
        );
      }

      if (authority.tenantId !== request.tenantId) {
        problems.push(
          `authority tenant "${authority.tenantId}" != request tenant "${request.tenantId}"`,
        );
      }
      // Company scope: a company-scoped authority confines the request and
      // fails closed when the request names no company at all.
      if (authority.companyId && authority.companyId !== request.companyId) {
        problems.push(
          `authority company "${authority.companyId}" != request company "${request.companyId ?? 'none'}"`,
        );
      }

      if (!authorityGrantsCapability(authority, capability)) {
        problems.push(
          `capability "${capability}" is not within delegated authority ${authority.authorityId}`,
        );
      }
      // Data scopes: every requested data class must be within the authority
      // (its own ceiling, independent of the actor's broader static grant).
      if (request.resourceDataClasses.length > 0) {
        const allowedData = new Set(authority.dataScopes.map(String));
        const missing = request.resourceDataClasses.filter(
          (c) => !allowedData.has(String(c)),
        );
        if (missing.length > 0) {
          problems.push(
            `data scope(s) [${missing.join(', ')}] not within delegated authority ${authority.authorityId}`,
          );
        }
      }

      if (!authorityAllowsRisk(authority, riskLevel)) {
        problems.push(
          `action risk ${riskLevel} exceeds delegated authority ceiling ${authority.maxRiskLevel}`,
        );
      }
      // Budget: the delegated spend ceiling, independent of the actor's budget.
      if (
        authority.budget !== undefined &&
        request.estimatedCost !== undefined &&
        request.estimatedCost > authority.budget
      ) {
        problems.push(
          `estimated cost ${request.estimatedCost} exceeds delegated authority budget ${authority.budget}`,
        );
      }

      // Provenance binding: an authority that declares an origin must be
      // presented with that exact provenance record. Authorities without a
      // provenanceId stay backward-compatible.
      if (authority.provenanceId) {
        const prov = ctx.authorityProvenance;
        if (!prov) {
          problems.push(
            `authority ${authority.authorityId} requires provenance ${authority.provenanceId} but none was supplied`,
          );
        } else if (prov.provenanceId !== authority.provenanceId) {
          problems.push(
            `supplied provenance ${prov.provenanceId} != authority provenance ${authority.provenanceId}`,
          );
        } else if (prov.subjectRef && prov.subjectRef !== authority.authorityId) {
          problems.push(
            `provenance subjectRef "${prov.subjectRef}" != authority ${authority.authorityId}`,
          );
        }
      }

      // Parent delegation: a child that declares a parent MUST be presented with
      // that active parent, and authority(child) ⊆ authority(parent) must hold —
      // including principal-chain continuity. Root authorities (no parent) skip
      // this. A parent supplied without a declaration is still enforced.
      if (authority.parentAuthorityId) {
        const parent = ctx.parentAuthority;
        if (!parent) {
          problems.push(
            `authority ${authority.authorityId} declares parent ${authority.parentAuthorityId} but no parentAuthority was supplied`,
          );
        } else if (parent.authorityId !== authority.parentAuthorityId) {
          problems.push(
            `supplied parent ${parent.authorityId} != declared parent ${authority.parentAuthorityId}`,
          );
        } else if (!authorityIsActive(parent, now)) {
          problems.push(`parent authority ${parent.authorityId} is not active`);
        } else {
          if (!principalChainContinues(parent, authority)) {
            problems.push(
              `principal chain does not continue parent ${parent.authorityId}`,
            );
          }
          const subset = authoritySubsumes(parent, authority);
          if (!subset.ok) {
            problems.push(
              `authority amplification: ${subset.violations.join('; ')}`,
            );
          }
        }
      } else if (ctx.parentAuthority) {
        if (!principalChainContinues(ctx.parentAuthority, authority)) {
          problems.push(
            `principal chain does not continue parent ${ctx.parentAuthority.authorityId}`,
          );
        }
        const subset = authoritySubsumes(ctx.parentAuthority, authority);
        if (!subset.ok) {
          problems.push(
            `authority amplification: ${subset.violations.join('; ')}`,
          );
        }
      }

      const passed = problems.length === 0;
      const detail = passed
        ? `delegated authority ${authority.authorityId} covers "${capability}" at ${riskLevel}` +
          (ctx.parentAuthority
            ? ` within parent ${ctx.parentAuthority.authorityId}`
            : '')
        : problems.join('; ');
      checks.push({ kind: 'authority-delegation', passed, detail });
      if (!passed) {
        return this.deny(detail, riskLevel, checks);
      }
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

    // 3a. Data scope — agent may only touch declared allowedData classes.
    if (actor.actorType === 'agent') {
      const agent = actor as AgentActor;
      const requested = request.resourceDataClasses ?? [];
      if (requested.length > 0) {
        const allowed = new Set(agent.allowedData.map(String));
        const missing = requested.filter((c) => !allowed.has(String(c)));
        const passed = missing.length === 0;
        const detail = passed
          ? `data scope ok (${requested.join(', ')})`
          : `data scope denied: missing allowedData for [${missing.join(', ')}] (actor allows [${agent.allowedData.join(', ') || '∅'}])`;
        checks.push({ kind: 'data-scope', passed, detail });
        if (!passed) {
          return this.deny(detail, riskLevel, checks);
        }
      }
    }

    // 3a2. Action Tier — Observe cannot Execute (ADR-007).
    // Enforce when Action Tier is declared, or when autonomy is L0 (Observe).
    // L1+ agents without actionTier keep prior authorize behavior (compat).
    if (actor.actorType === 'agent') {
      const agent = actor as AgentActor;
      const declared: ActionTier | undefined =
        agent.actionTier ??
        (agent.autonomyLevel === 'L0'
          ? actionTierFromAutonomy(agent.autonomyLevel)
          : undefined);
      if (declared !== undefined) {
        const required = requiredActionTierForCapability(String(capability));
        const tierOk = actionTierAllows(declared, required);
        const detail = tierOk
          ? `action tier ok (declared=${declared} required=${required} for ${capability})`
          : `action tier denied: ${declared} cannot perform ${required}-tier capability "${capability}"`;
        checks.push({ kind: 'action-tier', passed: tierOk, detail });
        if (!tierOk) {
          return this.deny(detail, riskLevel, checks);
        }
      }
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
        // Missing approval on a gated action → try earned autonomy waiver (M008);
        // bad binding → DENY.
        if (binding.missing) {
          const autonomy = evaluateAutonomy({
            grant: ctx.autonomyGrant,
            riskLevel,
            baselineRequiresApproval: true,
            manualDemote: ctx.manualAutonomyDemote,
          });
          checks.push({
            kind: 'autonomy-grant',
            passed: autonomy.waivesApproval,
            detail: autonomy.detail,
          });
          if (!autonomy.waivesApproval) {
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
          // Earned L4 waiver — continue to budget / final checks without a human gate.
        } else {
          return this.deny(binding.detail, riskLevel, checks);
        }
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
      const waived = this.tryAutonomyWaiver(riskLevel, capability, checks, ctx);
      if (waived) return waived;
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

  /**
   * Mission 008 — if an active L4 grant covers this risk, ALLOW without a
   * human gate. R3 is never waived.
   */
  private tryAutonomyWaiver(
    riskLevel: RiskLevel,
    _capability: Capability,
    checks: PolicyCheck[],
    ctx: AuthorizeContext,
  ): PolicyDecision | null {
    const autonomy = evaluateAutonomy({
      grant: ctx.autonomyGrant,
      riskLevel,
      baselineRequiresApproval: true,
      manualDemote: ctx.manualAutonomyDemote,
    });
    checks.push({
      kind: 'autonomy-grant',
      passed: autonomy.waivesApproval,
      detail: autonomy.detail,
    });
    if (!autonomy.waivesApproval) return null;
    return {
      decision: 'ALLOW',
      reason: autonomy.reason,
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
