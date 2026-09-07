import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/**
 * IE-001/IE-002 — Implementation Engine.
 *
 * Coordinates CRM, tenant setup, execution platform, and delivery process.
 * This is NOT a second runtime. Qualification is rule-based + human review;
 * model access must not block intake or package selection.
 *
 * IE-001: create case → intake → package recommendation → approve blueprint.
 * IE-002: provisioning readiness → activation_ready → human approval → active.
 */

/** Branded implementation case id (`icase_…`). */
export const ImplementationCaseId = z
  .string()
  .min(1)
  .brand('ImplementationCaseId');
export type ImplementationCaseId = z.infer<typeof ImplementationCaseId>;

export function newImplementationCaseId(): ImplementationCaseId {
  return `icase_${randomUUID()}` as ImplementationCaseId;
}

/** Commercial commitment — kept separate from technical readiness. */
export const COMMERCIAL_STATUSES = [
  'prospect',
  'signed',
  'paid',
  'on_hold',
  'declined',
  'churned',
] as const;
export const CommercialStatus = z.enum(COMMERCIAL_STATUSES);
export type CommercialStatus = z.infer<typeof CommercialStatus>;

/**
 * Delivery / technical readiness for the ImplementationCase.
 * A signed or paid client is NOT automatically activation-ready.
 *
 * IE-002 renames the post-provisioning gate to `activation_ready` → `active`
 * (replacing the IE-001 stubs `accepted` / `live`, which remain for compat).
 */
export const DELIVERY_STATUSES = [
  'draft',
  'intake_complete',
  'recommendation_ready',
  'blueprint_draft',
  'blueprint_approved',
  'provisioning',
  'activation_ready',
  'active',
  /** @deprecated IE-001 stub — prefer activation_ready */
  'accepted',
  /** @deprecated IE-001 stub — prefer active */
  'live',
  'on_hold',
  'declined',
] as const;
export const DeliveryStatus = z.enum(DELIVERY_STATUSES);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

/** Legal delivery status transitions (IE-001 + IE-002 activation gate). */
export const IMPLEMENTATION_DELIVERY_TRANSITIONS: Record<
  DeliveryStatus,
  readonly DeliveryStatus[]
> = {
  draft: ['intake_complete', 'on_hold', 'declined'],
  intake_complete: ['recommendation_ready', 'on_hold', 'declined'],
  recommendation_ready: ['blueprint_draft', 'on_hold', 'declined'],
  blueprint_draft: ['blueprint_approved', 'recommendation_ready', 'on_hold', 'declined'],
  blueprint_approved: ['provisioning', 'on_hold', 'declined'],
  provisioning: ['activation_ready', 'on_hold', 'declined'],
  activation_ready: ['active', 'provisioning', 'on_hold', 'declined'],
  active: ['on_hold'],
  accepted: ['activation_ready', 'live', 'active', 'on_hold'],
  live: ['active', 'on_hold'],
  on_hold: [
    'draft',
    'intake_complete',
    'recommendation_ready',
    'blueprint_draft',
    'blueprint_approved',
    'provisioning',
    'activation_ready',
    'accepted',
    'declined',
  ],
  declined: [],
};

export function canTransitionDelivery(
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean {
  if (from === to) return true;
  return IMPLEMENTATION_DELIVERY_TRANSITIONS[from].includes(to);
}

export function assertDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
): void {
  if (!canTransitionDelivery(from, to)) {
    throw new Error(`illegal delivery transition ${from} → ${to}`);
  }
}

export const PRIMARY_BOTTLENECKS = [
  'leads_lost_inquiry_followup',
  'intake_handoffs_updates_inconsistent',
  'repetitive_admin_consumes_owner_time',
  'booking_intake_delivery_reviews_disconnected',
] as const;
export const PrimaryBottleneck = z.enum(PRIMARY_BOTTLENECKS);
export type PrimaryBottleneck = z.infer<typeof PrimaryBottleneck>;

/**
 * Starting packages. Service Business Automation Stack is a reusable
 * configuration of the existing catalog — not an unpriced fifth offer.
 */
export const IMPLEMENTATION_PACKAGES = [
  'revenue_os',
  'client_ops_os',
  'ai_workforce_setup',
  'service_business_automation_stack',
] as const;
export const ImplementationPackage = z.enum(IMPLEMENTATION_PACKAGES);
export type ImplementationPackage = z.infer<typeof ImplementationPackage>;

export const PACKAGE_LABELS: Record<ImplementationPackage, string> = {
  revenue_os: 'Revenue OS',
  client_ops_os: 'Client Ops OS',
  ai_workforce_setup: 'AI Workforce Setup',
  service_business_automation_stack: 'Service Business Automation Stack',
};

/** Deterministic bottleneck → starting package map. */
export const BOTTLENECK_PACKAGE_MAP: Record<
  PrimaryBottleneck,
  ImplementationPackage
> = {
  leads_lost_inquiry_followup: 'revenue_os',
  intake_handoffs_updates_inconsistent: 'client_ops_os',
  repetitive_admin_consumes_owner_time: 'ai_workforce_setup',
  booking_intake_delivery_reviews_disconnected:
    'service_business_automation_stack',
};

export const QUALIFICATION_OUTCOMES = [
  'recommend_package',
  'request_discovery',
  'hold_missing_inputs',
  'decline_out_of_scope',
] as const;
export const QualificationOutcome = z.enum(QUALIFICATION_OUTCOMES);
export type QualificationOutcome = z.infer<typeof QualificationOutcome>;

export const PROVISIONING_STEP_KEYS = [
  'agreement_payment',
  'workspace_tenant',
  'ghl_connection',
  'model_access',
  'data_sources',
  'permissions',
  'baseline',
  'workflow_activation',
] as const;
export const ProvisioningStepKey = z.enum(PROVISIONING_STEP_KEYS);
export type ProvisioningStepKey = z.infer<typeof ProvisioningStepKey>;

export const PROVISIONING_STEP_STATUSES = [
  'pending',
  'running',
  'blocked',
  'failed',
  'verified',
] as const;
export const ProvisioningStepStatus = z.enum(PROVISIONING_STEP_STATUSES);
export type ProvisioningStepStatus = z.infer<typeof ProvisioningStepStatus>;

/** Steps that must be verified before activation_ready (IE-002). */
export const ACTIVATION_REQUIRED_STEPS: readonly ProvisioningStepKey[] = [
  'agreement_payment',
  'workspace_tenant',
  'ghl_connection',
  'model_access',
  'data_sources',
  'permissions',
  'baseline',
  'workflow_activation',
] as const;

/** Legal step status transitions — retry must not invent duplicate resources. */
export const PROVISIONING_STEP_TRANSITIONS: Record<
  ProvisioningStepStatus,
  readonly ProvisioningStepStatus[]
> = {
  pending: ['running', 'blocked', 'verified', 'failed'],
  running: ['verified', 'failed', 'blocked', 'pending'],
  blocked: ['pending', 'running', 'verified', 'failed'],
  failed: ['pending', 'running', 'blocked'],
  /** Re-open for recovery only — never create a second tenant/workspace/workflow. */
  verified: ['pending', 'blocked'],
};

export function canTransitionProvisioningStep(
  from: ProvisioningStepStatus,
  to: ProvisioningStepStatus,
): boolean {
  if (from === to) return true;
  return PROVISIONING_STEP_TRANSITIONS[from].includes(to);
}

export const EvidenceLink = z.object({
  label: z.string().min(1),
  url: z.string().url().optional(),
  note: z.string().optional(),
  recordedAt: z.string().datetime().optional(),
  recordedBy: z.string().optional(),
});
export type EvidenceLink = z.infer<typeof EvidenceLink>;

export const ImplementationIntake = z.object({
  businessContext: z.string().min(1),
  primaryBottleneck: PrimaryBottleneck,
  measurableProblem: z.string().min(1),
  namedOwner: z.string().min(1),
  accessReady: z.boolean(),
  accessNotes: z.string().optional(),
  baselineMetric: z.string().optional(),
  baselineSource: z.string().optional(),
  baselineDatedAt: z.string().datetime().optional(),
  approvedScope: z.boolean().default(false),
  deliveryCapacityFeasible: z.boolean().default(false),
  outOfScope: z.boolean().default(false),
  outOfScopeReason: z.string().optional(),
  needsDiscovery: z.boolean().default(false),
  discoveryNotes: z.string().optional(),
  /** Explicit: model access must not block intake (IE-001). */
  modelAccessStatus: z
    .enum(['not_required_yet', 'pending', 'verified', 'blocked'])
    .default('not_required_yet'),
  completedAt: z.string().datetime().optional(),
  completedBy: z.string().optional(),
});
export type ImplementationIntake = z.infer<typeof ImplementationIntake>;

export const PackageRecommendation = z.object({
  outcome: QualificationOutcome,
  recommendedPackage: ImplementationPackage.optional(),
  rationale: z.string().min(1),
  exclusions: z.array(z.string()).default([]),
  missingInputs: z.array(z.string()).default([]),
  readinessGates: z.object({
    namedOwner: z.boolean(),
    measurableProblem: z.boolean(),
    accessAvailable: z.boolean(),
    approvedScope: z.boolean(),
    deliveryCapacityFeasible: z.boolean(),
  }),
  /** Human review required before blueprint work. */
  requiresHumanReview: z.boolean().default(true),
  reviewedAt: z.string().datetime().optional(),
  reviewedBy: z.string().optional(),
  humanOverridePackage: ImplementationPackage.optional(),
  humanNotes: z.string().optional(),
  generatedAt: z.string().datetime(),
  ruleVersion: z.literal('ie001-qualification-v1').default('ie001-qualification-v1'),
});
export type PackageRecommendation = z.infer<typeof PackageRecommendation>;

export const SolutionBlueprint = z.object({
  version: z.number().int().positive().default(1),
  currentState: z.string().min(1),
  evidenceBackedGaps: z.array(z.string()).default([]),
  targetState: z.string().min(1),
  firstWorkflow: z.object({
    name: z.string().min(1),
    inputs: z.array(z.string()).default([]),
    outputs: z.array(z.string()).default([]),
  }),
  integrationMappings: z
    .array(
      z.object({
        system: z.string().min(1),
        mapping: z.string().min(1),
        dataOwner: z.string().min(1),
      }),
    )
    .default([]),
  allowedActions: z.array(z.string()).default([]),
  prohibitedActions: z.array(z.string()).default([]),
  humanApprovalPoints: z.array(z.string()).default([]),
  baselineKpi: z.string().min(1),
  targetKpi: z.string().min(1),
  measurementSource: z.string().min(1),
  acceptanceTests: z.array(z.string()).default([]),
  manualFallback: z.string().min(1),
  recoveryProcedure: z.string().min(1),
  deliveryOwner: z.string().min(1),
  rollout30: z.string().min(1),
  rollout60: z.string().min(1),
  rollout90: z.string().min(1),
  packageKey: ImplementationPackage,
  status: z.enum(['draft', 'approved']).default('draft'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  approvedBy: z.string().optional(),
  changeRequiresRenewedApproval: z.boolean().default(true),
});
export type SolutionBlueprint = z.infer<typeof SolutionBlueprint>;

export const ProvisioningStep = z.object({
  key: ProvisioningStepKey,
  status: ProvisioningStepStatus.default('pending'),
  evidence: z.string().optional(),
  completedBy: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
  blockReason: z.string().optional(),
});
export type ProvisioningStep = z.infer<typeof ProvisioningStep>;

export const ProvisioningChecklist = z.object({
  steps: z.array(ProvisioningStep),
  updatedAt: z.string().datetime().optional(),
});
export type ProvisioningChecklist = z.infer<typeof ProvisioningChecklist>;

/** Default checklist: GHL + model access visibly blocked until verified. */
export function defaultProvisioningChecklist(
  now: string = new Date().toISOString(),
): ProvisioningChecklist {
  const blocked = (
    key: ProvisioningStepKey,
    reason: string,
  ): ProvisioningStep => ({
    key,
    status: 'blocked',
    blockReason: reason,
    updatedAt: now,
  });
  const pending = (key: ProvisioningStepKey): ProvisioningStep => ({
    key,
    status: 'pending',
    updatedAt: now,
  });
  return {
    steps: [
      pending('agreement_payment'),
      pending('workspace_tenant'),
      blocked(
        'ghl_connection',
        'GHL connection not verified — wait for live integration proof',
      ),
      blocked(
        'model_access',
        'Model access is a downstream gate — does not block intake/package selection',
      ),
      pending('data_sources'),
      pending('permissions'),
      pending('baseline'),
      blocked(
        'workflow_activation',
        'Automatic workflow activation deferred until acceptance + monitoring ready',
      ),
    ],
    updatedAt: now,
  };
}

export const ImplementationCase = z.object({
  caseId: ImplementationCaseId,
  /** Operator / holding tenant that owns the delivery work. */
  tenantId: z.string().min(1),
  /** Client / customer tenant or commercial reference. */
  clientRef: z.string().min(1),
  clientName: z.string().min(1),
  ownerId: z.string().min(1),
  commercialStatus: CommercialStatus.default('prospect'),
  deliveryStatus: DeliveryStatus.default('draft'),
  nextAction: z.string().optional(),
  blockers: z.array(z.string()).default([]),
  evidenceLinks: z.array(EvidenceLink).default([]),
  intake: ImplementationIntake.optional(),
  recommendation: PackageRecommendation.optional(),
  blueprint: SolutionBlueprint.optional(),
  provisioning: ProvisioningChecklist.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type ImplementationCase = z.infer<typeof ImplementationCase>;

export interface CreateImplementationCaseInput {
  tenantId: string;
  clientRef: string;
  clientName: string;
  ownerId: string;
  commercialStatus?: CommercialStatus;
  nextAction?: string;
  evidenceLinks?: EvidenceLink[];
  metadata?: Record<string, unknown>;
  caseId?: ImplementationCaseId;
  createdAt?: string;
}

export function createImplementationCase(
  input: CreateImplementationCaseInput,
): ImplementationCase {
  const now = input.createdAt ?? new Date().toISOString();
  return ImplementationCase.parse({
    caseId: input.caseId ?? newImplementationCaseId(),
    tenantId: input.tenantId,
    clientRef: input.clientRef,
    clientName: input.clientName,
    ownerId: input.ownerId,
    commercialStatus: input.commercialStatus ?? 'prospect',
    deliveryStatus: 'draft',
    nextAction: input.nextAction ?? 'Complete intake',
    blockers: [],
    evidenceLinks: input.evidenceLinks ?? [],
    provisioning: defaultProvisioningChecklist(now),
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ?? {},
  });
}

export interface QualifyIntakeInput {
  intake: ImplementationIntake;
  now?: string;
}

/**
 * Deterministic IE-001 qualification.
 * Model access status is ignored for package selection (must not block).
 */
export function qualifyIntake(input: QualifyIntakeInput): PackageRecommendation {
  const { intake } = input;
  const now = input.now ?? new Date().toISOString();
  const gates = {
    namedOwner: Boolean(intake.namedOwner?.trim()),
    measurableProblem: Boolean(intake.measurableProblem?.trim()),
    accessAvailable: intake.accessReady === true,
    approvedScope: intake.approvedScope === true,
    deliveryCapacityFeasible: intake.deliveryCapacityFeasible === true,
  };
  const missingInputs: string[] = [];
  if (!gates.namedOwner) missingInputs.push('named_owner');
  if (!gates.measurableProblem) missingInputs.push('measurable_problem');
  if (!gates.accessAvailable) missingInputs.push('access_ready');
  if (!gates.approvedScope) missingInputs.push('approved_scope');
  if (!gates.deliveryCapacityFeasible) missingInputs.push('delivery_capacity');

  if (intake.outOfScope) {
    return PackageRecommendation.parse({
      outcome: 'decline_out_of_scope',
      rationale:
        intake.outOfScopeReason?.trim() ||
        'Prospect marked out of scope during intake',
      exclusions: ['all_packages'],
      missingInputs: [],
      readinessGates: gates,
      requiresHumanReview: true,
      generatedAt: now,
      ruleVersion: 'ie001-qualification-v1',
    });
  }

  if (intake.needsDiscovery) {
    return PackageRecommendation.parse({
      outcome: 'request_discovery',
      recommendedPackage: BOTTLENECK_PACKAGE_MAP[intake.primaryBottleneck],
      rationale:
        intake.discoveryNotes?.trim() ||
        'Intake flagged discovery before package commitment',
      exclusions: [],
      missingInputs,
      readinessGates: gates,
      requiresHumanReview: true,
      generatedAt: now,
      ruleVersion: 'ie001-qualification-v1',
    });
  }

  if (missingInputs.length > 0) {
    return PackageRecommendation.parse({
      outcome: 'hold_missing_inputs',
      recommendedPackage: BOTTLENECK_PACKAGE_MAP[intake.primaryBottleneck],
      rationale: `Hold — missing readiness inputs: ${missingInputs.join(', ')}`,
      exclusions: [],
      missingInputs,
      readinessGates: gates,
      requiresHumanReview: true,
      generatedAt: now,
      ruleVersion: 'ie001-qualification-v1',
    });
  }

  const pkg = BOTTLENECK_PACKAGE_MAP[intake.primaryBottleneck];
  const exclusions =
    pkg === 'service_business_automation_stack'
      ? [
          'Not a separately priced fifth offer — reusable catalog configuration only until commercially packaged',
        ]
      : [];

  return PackageRecommendation.parse({
    outcome: 'recommend_package',
    recommendedPackage: pkg,
    rationale: `Primary bottleneck "${intake.primaryBottleneck}" maps to ${PACKAGE_LABELS[pkg]} (ie001-qualification-v1). Model access is a downstream gate and did not influence this recommendation.`,
    exclusions,
    missingInputs: [],
    readinessGates: gates,
    requiresHumanReview: true,
    generatedAt: now,
    ruleVersion: 'ie001-qualification-v1',
  });
}

export interface DraftBlueprintInput {
  caseRecord: ImplementationCase;
  packageKey: ImplementationPackage;
  deliveryOwner: string;
  overrides?: Partial<SolutionBlueprint>;
  now?: string;
}

/** Draft a versioned blueprint from intake + recommended package. */
export function draftBlueprintFromCase(
  input: DraftBlueprintInput,
): SolutionBlueprint {
  const now = input.now ?? new Date().toISOString();
  const intake = input.caseRecord.intake;
  const pkg = input.packageKey;
  const label = PACKAGE_LABELS[pkg];

  const base: SolutionBlueprint = SolutionBlueprint.parse({
    version: (input.caseRecord.blueprint?.version ?? 0) + 1,
    currentState:
      intake?.businessContext ??
      `Client ${input.caseRecord.clientName} awaiting ${label} delivery`,
    evidenceBackedGaps: [
      intake?.measurableProblem ?? 'Measurable problem not yet recorded',
      ...(intake?.baselineMetric
        ? [`Baseline: ${intake.baselineMetric}`]
        : ['Baseline metric missing']),
    ],
    targetState: `Operate ${label} with one approved live workflow and weekly reporting`,
    firstWorkflow: {
      name:
        pkg === 'revenue_os'
          ? 'Revenue follow-up loop'
          : pkg === 'client_ops_os'
            ? 'Client intake + handoff loop'
            : pkg === 'ai_workforce_setup'
              ? 'Owner admin relief loop'
              : 'Booking → delivery → review loop',
      inputs: ['qualified_lead_or_request', 'tenant_context'],
      outputs: ['recorded_action', 'exception_or_handoff', 'cost_units'],
    },
    integrationMappings: [
      {
        system: 'GoHighLevel',
        mapping: 'CRM location binding (blocked until connection verified)',
        dataOwner: input.caseRecord.clientRef,
      },
      {
        system: 'AION Runtime',
        mapping: 'Governed mission / workflow execution',
        dataOwner: input.caseRecord.tenantId,
      },
    ],
    allowedActions: [
      'create_implementation_records',
      'run_approved_workflow_steps',
      'request_human_approval',
    ],
    prohibitedActions: [
      'autonomous_customer_messaging',
      'automatic_workflow_activation_without_acceptance',
      'commercial_expansion_triggers_without_human_review',
    ],
    humanApprovalPoints: [
      'package_recommendation_review',
      'blueprint_approval',
      'workflow_activation',
    ],
    baselineKpi: intake?.baselineMetric ?? 'TBD — record dated baseline before go-live',
    targetKpi: 'First approved live workflow with recorded outcome + cost',
    measurementSource: intake?.baselineSource ?? 'Operator Console + Runtime economics',
    acceptanceTests: [
      'Tenant isolation deny without x-aion-tenant-id',
      'Prohibited action blocked by policy',
      'Failure path preserves completed provisioning evidence',
      'Recovery procedure documented and exercised',
    ],
    manualFallback: 'Operator completes the step manually and records evidence + actor id',
    recoveryProcedure:
      'Resume from last verified provisioning step; never recreate tenant/workspace/workflow duplicates',
    deliveryOwner: input.deliveryOwner,
    rollout30: 'Activate first workflow; weekly client report; exception log',
    rollout60: 'Stabilize handoffs; tighten permissions; review KPI vs baseline',
    rollout90: 'Confirm success plan; decide expand / hold / revise blueprint',
    packageKey: pkg,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    changeRequiresRenewedApproval: true,
  });

  if (!input.overrides) return base;
  return SolutionBlueprint.parse({
    ...base,
    ...input.overrides,
    version: base.version,
    packageKey: pkg,
    status: 'draft',
    createdAt: base.createdAt,
    updatedAt: now,
    approvedAt: undefined,
    approvedBy: undefined,
  });
}

export function applyIntake(
  caseRecord: ImplementationCase,
  intakeInput: ImplementationIntake | Record<string, unknown>,
  now: string = new Date().toISOString(),
): ImplementationCase {
  const intake = ImplementationIntake.parse(intakeInput);
  assertDeliveryTransition(caseRecord.deliveryStatus, 'intake_complete');
  const recommendation = qualifyIntake({ intake, now });
  const nextDelivery: DeliveryStatus =
    recommendation.outcome === 'decline_out_of_scope'
      ? 'declined'
      : 'recommendation_ready';
  assertDeliveryTransition('intake_complete', nextDelivery);

  const blockers: string[] = [];
  if (recommendation.outcome === 'hold_missing_inputs') {
    blockers.push(...recommendation.missingInputs.map((m) => `missing:${m}`));
  }
  if (recommendation.outcome === 'request_discovery') {
    blockers.push('discovery_required');
  }

  return ImplementationCase.parse({
    ...caseRecord,
    intake: {
      ...intake,
      completedAt: intake.completedAt ?? now,
    },
    recommendation,
    deliveryStatus: nextDelivery,
    nextAction:
      nextDelivery === 'declined'
        ? 'Case declined — no blueprint'
        : recommendation.outcome === 'recommend_package'
          ? 'Review package recommendation and draft blueprint'
          : recommendation.outcome === 'request_discovery'
            ? 'Schedule discovery'
            : 'Resolve missing readiness inputs',
    blockers,
    updatedAt: now,
  });
}

export function attachBlueprintDraft(
  caseRecord: ImplementationCase,
  blueprint: SolutionBlueprint,
  now: string = new Date().toISOString(),
): ImplementationCase {
  if (
    caseRecord.deliveryStatus !== 'recommendation_ready' &&
    caseRecord.deliveryStatus !== 'blueprint_draft'
  ) {
    throw new Error(
      `cannot draft blueprint from deliveryStatus=${caseRecord.deliveryStatus}`,
    );
  }
  assertDeliveryTransition(caseRecord.deliveryStatus, 'blueprint_draft');
  return ImplementationCase.parse({
    ...caseRecord,
    blueprint: { ...blueprint, status: 'draft', updatedAt: now },
    deliveryStatus: 'blueprint_draft',
    nextAction: 'Edit blueprint and obtain accountable approval',
    updatedAt: now,
  });
}

export function approveBlueprint(
  caseRecord: ImplementationCase,
  approvedBy: string,
  now: string = new Date().toISOString(),
): ImplementationCase {
  if (!caseRecord.blueprint) {
    throw new Error('cannot approve blueprint — none attached');
  }
  if (caseRecord.blueprint.status === 'approved') {
    return caseRecord;
  }
  assertDeliveryTransition(caseRecord.deliveryStatus, 'blueprint_approved');
  return ImplementationCase.parse({
    ...caseRecord,
    blueprint: {
      ...caseRecord.blueprint,
      status: 'approved',
      approvedAt: now,
      approvedBy,
      updatedAt: now,
    },
    deliveryStatus: 'blueprint_approved',
    nextAction:
      'Start provisioning — verify GHL, model access, and remaining readiness steps before activation',
    blockers: (caseRecord.blockers ?? []).filter(
      (b) => !b.startsWith('missing:') && b !== 'discovery_required',
    ),
    updatedAt: now,
  });
}

function ensureProvisioningChecklist(
  caseRecord: ImplementationCase,
  now: string,
): ProvisioningChecklist {
  if (caseRecord.provisioning?.steps?.length) {
    return caseRecord.provisioning;
  }
  return defaultProvisioningChecklist(now);
}

function syncProvisioningBlockers(
  steps: ProvisioningStep[],
): string[] {
  return steps
    .filter((s) => s.status === 'blocked' || s.status === 'failed')
    .map((s) =>
      s.status === 'failed'
        ? `failed:${s.key}`
        : `blocked:${s.key}`,
    );
}

/**
 * IE-002 — enter provisioning after blueprint approval.
 * Blocked steps remain blocked until explicitly verified with evidence.
 */
export function startProvisioning(
  caseRecord: ImplementationCase,
  startedBy: string,
  now: string = new Date().toISOString(),
): ImplementationCase {
  assertDeliveryTransition(caseRecord.deliveryStatus, 'provisioning');
  if (caseRecord.blueprint?.status !== 'approved') {
    throw new Error('cannot start provisioning — blueprint not approved');
  }
  const provisioning = ensureProvisioningChecklist(caseRecord, now);
  return ImplementationCase.parse({
    ...caseRecord,
    deliveryStatus: 'provisioning',
    provisioning: {
      ...provisioning,
      updatedAt: now,
    },
    nextAction:
      'Verify provisioning steps with evidence (GHL + model access are activation gates)',
    blockers: syncProvisioningBlockers(provisioning.steps),
    metadata: {
      ...caseRecord.metadata,
      provisioningStartedBy: startedBy,
      provisioningStartedAt: now,
    },
    updatedAt: now,
  });
}

export interface UpdateProvisioningStepInput {
  key: ProvisioningStepKey;
  status: ProvisioningStepStatus;
  evidence?: string;
  completedBy?: string;
  blockReason?: string;
}

/**
 * IE-002 — update one provisioning step. Idempotent on same status.
 * Verified steps require evidence + completedBy (no invisible manual work).
 */
export function updateProvisioningStep(
  caseRecord: ImplementationCase,
  input: UpdateProvisioningStepInput,
  now: string = new Date().toISOString(),
): ImplementationCase {
  if (caseRecord.deliveryStatus !== 'provisioning') {
    throw new Error(
      `cannot update provisioning step from deliveryStatus=${caseRecord.deliveryStatus} — start provisioning first`,
    );
  }

  const provisioning = ensureProvisioningChecklist(caseRecord, now);
  const idx = provisioning.steps.findIndex((s) => s.key === input.key);
  if (idx < 0) {
    throw new Error(`unknown provisioning step ${input.key}`);
  }
  const current = provisioning.steps[idx]!;
  if (!canTransitionProvisioningStep(current.status, input.status)) {
    throw new Error(
      `illegal provisioning step transition ${current.key}: ${current.status} → ${input.status}`,
    );
  }
  if (input.status === 'verified') {
    if (!input.evidence?.trim()) {
      throw new Error(`verified step ${input.key} requires evidence`);
    }
    if (!input.completedBy?.trim()) {
      throw new Error(`verified step ${input.key} requires completedBy`);
    }
  }

  const nextStep: ProvisioningStep = {
    ...current,
    status: input.status,
    updatedAt: now,
    ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
    ...(input.completedBy !== undefined
      ? { completedBy: input.completedBy }
      : {}),
    ...(input.status === 'blocked'
      ? {
          blockReason:
            input.blockReason?.trim() ||
            current.blockReason ||
            'blocked pending verification',
        }
      : input.status === 'verified'
        ? { blockReason: undefined }
        : input.blockReason !== undefined
          ? { blockReason: input.blockReason }
          : {}),
  };

  const steps = provisioning.steps.map((s, i) => (i === idx ? nextStep : s));
  const blockers = syncProvisioningBlockers(steps);
  const unverified = ACTIVATION_REQUIRED_STEPS.filter((key) => {
    const step = steps.find((s) => s.key === key);
    return !step || step.status !== 'verified';
  });

  return ImplementationCase.parse({
    ...caseRecord,
    deliveryStatus: 'provisioning',
    provisioning: { steps, updatedAt: now },
    blockers,
    nextAction:
      unverified.length === 0
        ? 'All required steps verified — mark activation ready'
        : `Verify remaining steps: ${unverified.join(', ')}`,
    updatedAt: now,
  });
}

export function listUnverifiedActivationSteps(
  caseRecord: ImplementationCase,
): ProvisioningStepKey[] {
  const steps = caseRecord.provisioning?.steps ?? [];
  return ACTIVATION_REQUIRED_STEPS.filter((key) => {
    const step = steps.find((s) => s.key === key);
    return !step || step.status !== 'verified';
  });
}

/**
 * IE-002 — all required steps verified → activation_ready (not yet live).
 */
export function markActivationReady(
  caseRecord: ImplementationCase,
  markedBy: string,
  now: string = new Date().toISOString(),
): ImplementationCase {
  assertDeliveryTransition(caseRecord.deliveryStatus, 'activation_ready');
  const missing = listUnverifiedActivationSteps(caseRecord);
  if (missing.length > 0) {
    throw new Error(
      `cannot mark activation ready — unverified steps: ${missing.join(', ')}`,
    );
  }
  return ImplementationCase.parse({
    ...caseRecord,
    deliveryStatus: 'activation_ready',
    blockers: [],
    nextAction:
      'Human approval required to activate — then feed first live workflow (OL-001 Mission 001)',
    metadata: {
      ...caseRecord.metadata,
      activationReadyBy: markedBy,
      activationReadyAt: now,
    },
    updatedAt: now,
  });
}

/**
 * IE-002 — human activation gate. Generator/checklist never auto-activates.
 * Re-activating an already-active case is idempotent (same record returned).
 */
export function activateImplementation(
  caseRecord: ImplementationCase,
  approvedBy: string,
  now: string = new Date().toISOString(),
): ImplementationCase {
  if (!approvedBy.trim()) {
    throw new Error('activate requires approvedBy (human gate)');
  }
  if (caseRecord.deliveryStatus === 'active') {
    return caseRecord;
  }
  assertDeliveryTransition(caseRecord.deliveryStatus, 'active');
  if (caseRecord.deliveryStatus !== 'activation_ready') {
    throw new Error(
      `cannot activate from deliveryStatus=${caseRecord.deliveryStatus} — mark activation_ready first`,
    );
  }
  const missing = listUnverifiedActivationSteps(caseRecord);
  if (missing.length > 0) {
    throw new Error(
      `cannot activate — unverified steps: ${missing.join(', ')}`,
    );
  }
  return ImplementationCase.parse({
    ...caseRecord,
    deliveryStatus: 'active',
    blockers: [],
    nextAction:
      'Active — launch first approved live workflow (OL-001 Mission 001 feeder)',
    metadata: {
      ...caseRecord.metadata,
      activatedBy: approvedBy,
      activatedAt: now,
    },
    evidenceLinks: [
      ...(caseRecord.evidenceLinks ?? []),
      {
        label: 'activation_approval',
        note: `Activated by ${approvedBy}`,
        recordedAt: now,
        recordedBy: approvedBy,
      },
    ],
    updatedAt: now,
  });
}
