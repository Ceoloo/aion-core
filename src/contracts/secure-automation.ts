/**
 * Secure Automation Deployment Standard (SA-STD-001).
 *
 * Versioned deployment profile for Implementation Engine deliveries.
 * Reuses Agent OS controls and canonical records — not a second runtime.
 *
 * First operable workflow: Lead-to-Appointment v1 (Revenue OS).
 * Commercial / vendor / regulatory language from offer catalogs is treated as
 * research input until independently verified for client-facing claims.
 */

import { z } from 'zod';
import type { ImplementationPackage } from './implementation-case.js';

/** Canonical standard identity. */
export const SECURE_AUTOMATION_STANDARD_ID = 'SA-STD-001' as const;

/** Current published standard version. Bump when control requirements change. */
export const SECURE_AUTOMATION_STANDARD_VERSION = '1.0.0' as const;

export const SecureAutomationControlId = z.enum([
  'tenant_isolation',
  'scoped_permissions',
  'approved_communication',
  'durable_execution',
  'duplicate_prevention',
  'auditability',
  'outcome_measurement',
]);
export type SecureAutomationControlId = z.infer<typeof SecureAutomationControlId>;

export const SecureAutomationControl = z.object({
  id: SecureAutomationControlId,
  title: z.string().min(1),
  requirement: z.string().min(1),
  /** Existing Agent OS / platform mechanism that satisfies the control. */
  agentOsMechanism: z.string().min(1),
  /** Canonical record / contract that evidences compliance. */
  canonicalRecord: z.string().min(1),
});
export type SecureAutomationControl = z.infer<typeof SecureAutomationControl>;

export const SECURE_AUTOMATION_CONTROLS: readonly SecureAutomationControl[] = [
  {
    id: 'tenant_isolation',
    title: 'Tenant isolation',
    requirement:
      'Every implementation and execution path requires an explicit tenant boundary; cross-tenant access is denied.',
    agentOsMechanism: 'x-aion-tenant-id gateway enforcement + Actor/Scope contracts',
    canonicalRecord: 'ImplementationCase.tenantId / Run.tenantId / ExternalSideEffect.tenantId',
  },
  {
    id: 'scoped_permissions',
    title: 'Scoped permissions',
    requirement:
      'Workflows declare an allow-listed capability set; Runtime policy must ALLOW each step before adapter invocation.',
    agentOsMechanism: 'Capability + Policy + ServiceDefinition.requiredPermissions',
    canonicalRecord: 'ServiceDefinition / Mission permissions / Approval gates',
  },
  {
    id: 'approved_communication',
    title: 'Approved communication rules',
    requirement:
      'Customer-facing sends are prohibited by default. Draft-only messaging is allowed with approval; send remains R3-gated.',
    agentOsMechanism:
      'Blueprint prohibitedActions + crm.message.draft (R2) vs crm.message.send (R3 approvalRequired)',
    canonicalRecord: 'SolutionBlueprint.prohibitedActions / Approval / ExternalSideEffect',
  },
  {
    id: 'durable_execution',
    title: 'Durable execution',
    requirement:
      'Runs persist lifecycle state; retries resume from recorded progress without inventing a parallel execution graph.',
    agentOsMechanism: 'Run/Execution repositories + Orchestrator lifecycle transitions',
    canonicalRecord: 'Run / Execution / Event stream',
  },
  {
    id: 'duplicate_prevention',
    title: 'Duplicate prevention',
    requirement:
      'External mutations carry idempotency keys; provisioning recovery must not recreate tenant/workspace/workflow duplicates.',
    agentOsMechanism: 'ExternalSideEffect.idempotencyKey + IE-002 verified-step reopen rules',
    canonicalRecord: 'ExternalSideEffect / ProvisioningChecklist',
  },
  {
    id: 'auditability',
    title: 'Auditability',
    requirement:
      'Who authorized what, which capability ran, and what external mutation occurred must be reconstructable.',
    agentOsMechanism: 'Telemetry + Events + Approval + ExternalSideEffect ledger',
    canonicalRecord: 'Event / Telemetry / Approval / ExternalSideEffect',
  },
  {
    id: 'outcome_measurement',
    title: 'Outcome measurement',
    requirement:
      'Each live workflow records baseline, target KPI, cost units, and outcome class for OL scoreboard use.',
    agentOsMechanism: 'SolutionBlueprint baseline/target KPI + Outcome + Economics contracts',
    canonicalRecord: 'Outcome / Economics / SolutionBlueprint.measurementSource',
  },
] as const;

export const SecureAutomationWorkflowStep = z.object({
  name: z.string().min(1),
  capability: z.string().min(1),
  riskLevel: z.enum(['R0', 'R1', 'R2', 'R3']),
  approvalRequired: z.boolean(),
  description: z.string().min(1),
  /** When true, step is human-operated until a catalog capability is active. */
  humanOperated: z.boolean().default(false),
});
export type SecureAutomationWorkflowStep = z.infer<
  typeof SecureAutomationWorkflowStep
>;

export const SecureAutomationWorkflow = z.object({
  workflowId: z.string().min(1),
  label: z.string().min(1),
  version: z.string().min(1),
  packageKey: z.enum([
    'revenue_os',
    'client_ops_os',
    'ai_workforce_setup',
    'service_business_automation_stack',
  ]),
  description: z.string().min(1),
  /** Capabilities the launching actor may hold for this workflow. */
  permissions: z.array(z.string().min(1)),
  steps: z.array(SecureAutomationWorkflowStep).min(1),
  /** Explicitly blocked capabilities for this workflow version. */
  prohibitedCapabilities: z.array(z.string().min(1)).default([]),
  inputs: z.array(z.string().min(1)).default([]),
  outputs: z.array(z.string().min(1)).default([]),
  baselineKpiDefault: z.string().min(1),
  targetKpiDefault: z.string().min(1),
  measurementSourceDefault: z.string().min(1),
});
export type SecureAutomationWorkflow = z.infer<typeof SecureAutomationWorkflow>;

/**
 * Lead-to-Appointment v1 — minimum operable path using existing active catalog
 * capabilities. Calendar booking remains human-operated until appointment
 * services are certified (AIO-17). Customer send is prohibited in this version.
 */
export const LEAD_TO_APPOINTMENT_V1: SecureAutomationWorkflow =
  SecureAutomationWorkflow.parse({
    workflowId: 'lead-to-appointment-v1',
    label: 'Lead-to-Appointment v1',
    version: '1.0.0',
    packageKey: 'revenue_os',
    description:
      'Secure Automation first workflow: research → enrich → opportunity/task/note → draft follow-up → human books appointment. No autonomous send; no live calendar API.',
    permissions: [
      'revenue.lead.research',
      'revenue.lead.enrich',
      'crm.contact.read',
      'crm.contact.enrich',
      'crm.opportunity.create',
      'crm.opportunity.update',
      'crm.note.create',
      'crm.task.create',
      'crm.message.draft',
    ],
    steps: [
      {
        name: 'research',
        capability: 'revenue.lead.research',
        riskLevel: 'R1',
        approvalRequired: false,
        description: 'Research inbound / sourced lead',
        humanOperated: false,
      },
      {
        name: 'enrich',
        capability: 'revenue.lead.enrich',
        riskLevel: 'R1',
        approvalRequired: false,
        description: 'Enrich lead profile into CRM-safe attributes',
        humanOperated: false,
      },
      {
        name: 'opportunity',
        capability: 'crm.opportunity.create',
        riskLevel: 'R2',
        approvalRequired: true,
        description: 'Create or update pipeline opportunity (idempotent)',
        humanOperated: false,
      },
      {
        name: 'follow-up-task',
        capability: 'crm.task.create',
        riskLevel: 'R1',
        approvalRequired: false,
        description: 'Create appointment-setting task for human / setter',
        humanOperated: false,
      },
      {
        name: 'crm-note',
        capability: 'crm.note.create',
        riskLevel: 'R1',
        approvalRequired: false,
        description: 'Record qualification notes on the contact/opportunity',
        humanOperated: false,
      },
      {
        name: 'draft-message',
        capability: 'crm.message.draft',
        riskLevel: 'R2',
        approvalRequired: true,
        description: 'Draft approved follow-up copy (no send)',
        humanOperated: false,
      },
      {
        name: 'book-appointment',
        capability: 'human.appointment.book',
        riskLevel: 'R2',
        approvalRequired: true,
        description:
          'Human books appointment in CRM calendar; reserved for future crm.appointment.* services',
        humanOperated: true,
      },
    ],
    prohibitedCapabilities: [
      'crm.message.send',
      'autonomous_customer_messaging',
      'automatic_workflow_activation_without_acceptance',
    ],
    inputs: [
      'qualified_lead_or_inquiry',
      'tenant_context',
      'approved_communication_rules',
    ],
    outputs: [
      'enriched_contact_or_opportunity',
      'appointment_task_or_booking_evidence',
      'draft_follow_up',
      'outcome_and_cost_units',
    ],
    baselineKpiDefault:
      'Lead → appointment conversion rate (dated baseline before go-live)',
    targetKpiDefault:
      'First approved L2A run with booked appointment evidence + cost units',
    measurementSourceDefault:
      'Operator Console mission outcomes + Runtime economics + CRM opportunity/task records',
  });

export const SECURE_AUTOMATION_WORKFLOWS: readonly SecureAutomationWorkflow[] = [
  LEAD_TO_APPOINTMENT_V1,
];

export function getSecureAutomationWorkflow(
  workflowId: string,
): SecureAutomationWorkflow | undefined {
  return SECURE_AUTOMATION_WORKFLOWS.find((w) => w.workflowId === workflowId);
}

export function defaultWorkflowForPackage(
  packageKey: ImplementationPackage,
): SecureAutomationWorkflow | undefined {
  if (packageKey === 'revenue_os') return LEAD_TO_APPOINTMENT_V1;
  return undefined;
}

export const SecureAutomationProfile = z.object({
  standardId: z.literal(SECURE_AUTOMATION_STANDARD_ID),
  standardVersion: z.string().min(1),
  workflowId: z.string().min(1),
  workflowVersion: z.string().min(1),
  controls: z.array(SecureAutomationControlId),
});
export type SecureAutomationProfile = z.infer<typeof SecureAutomationProfile>;

export function buildSecureAutomationProfile(
  workflow: SecureAutomationWorkflow = LEAD_TO_APPOINTMENT_V1,
): SecureAutomationProfile {
  return SecureAutomationProfile.parse({
    standardId: SECURE_AUTOMATION_STANDARD_ID,
    standardVersion: SECURE_AUTOMATION_STANDARD_VERSION,
    workflowId: workflow.workflowId,
    workflowVersion: workflow.version,
    controls: SECURE_AUTOMATION_CONTROLS.map((c) => c.id),
  });
}

export const OlProgramId = z.enum([
  'OL-001',
  'OL-002',
  'OL-003',
  'OL-004',
  'OL-005',
]);
export type OlProgramId = z.infer<typeof OlProgramId>;

export const OlVerificationMapping = z.object({
  olId: OlProgramId,
  title: z.string().min(1),
  howL2aContributes: z.string().min(1),
  verificationStatus: z.enum([
    'not_started',
    'partial',
    'blocked',
    'satisfied_for_standard',
  ]),
  evidenceNeeded: z.array(z.string().min(1)),
  notes: z.string().min(1),
});
export type OlVerificationMapping = z.infer<typeof OlVerificationMapping>;

/**
 * Map Secure Automation L2A verification onto OL-001–005.
 * This does NOT claim OL-001 cohort completion.
 */
export const OL_VERIFICATION_MAP: readonly OlVerificationMapping[] = [
  {
    olId: 'OL-001',
    title: 'Revenue Production Loop',
    howL2aContributes:
      'L2A v1 is a versioned Revenue OS workflow that can feed supervised OL-001 missions once activation gates clear.',
    verificationStatus: 'blocked',
    evidenceNeeded: [
      'IE-002 activation_ready → active for a real client/tenant',
      'Live GHL location proof (not config-presence only)',
      'Model provider access verified (AIO-16)',
      'Supervised mission runs with outcome + cost recorded',
    ],
    notes:
      'Do not count Implementation Engine blueprint work as OL-001 missions. Cohort target remains 100 real revenue missions.',
  },
  {
    olId: 'OL-002',
    title: 'Client Production Loop',
    howL2aContributes:
      'Tenant-isolated L2A packaging is the intended first client workflow after OL-001 baseline.',
    verificationStatus: 'not_started',
    evidenceNeeded: [
      'OL-001 trustworthy baseline',
      'One external client tenant activated under SA-STD-001',
    ],
    notes: 'Deferred by operating-leverage doctrine until OL-001 baseline exists.',
  },
  {
    olId: 'OL-003',
    title: 'Unit economics',
    howL2aContributes:
      'L2A steps emit cost units through existing Economics contracts; KPI fields are required on blueprints.',
    verificationStatus: 'partial',
    evidenceNeeded: [
      'Cost units on completed L2A missions',
      'Human minutes / successful appointment recorded',
      'Margin vs delivery fee for at least one engagement',
    ],
    notes: 'Contracts exist (M005); production evidence does not yet.',
  },
  {
    olId: 'OL-004',
    title: 'Workforce optimization',
    howL2aContributes:
      'Eval/scorecard hooks on CRM capabilities enable routing and intervention analysis after volume.',
    verificationStatus: 'not_started',
    evidenceNeeded: [
      'Enough L2A executions for M007 scorecards',
      'Intervention pattern review across workflow versions',
    ],
    notes: 'Requires production volume after OL-001 start.',
  },
  {
    olId: 'OL-005',
    title: 'Productization',
    howL2aContributes:
      'SA-STD-001 + L2A v1 are the first reusable deployment package for Revenue OS deliveries.',
    verificationStatus: 'partial',
    evidenceNeeded: [
      'Repeatable IE intake → blueprint → provision → activate path using L2A',
      'Console template selectable for operators',
      'Docs + blockers list kept current',
    ],
    notes:
      'Standard and Console template land now; live productization waits on AIO-16/17 and activation.',
  },
] as const;

export const ProductionBlocker = z.object({
  id: z.string().min(1),
  severity: z.enum(['P0', 'P1', 'P2']),
  title: z.string().min(1),
  detail: z.string().min(1),
  blocks: z.array(z.string().min(1)),
});
export type ProductionBlocker = z.infer<typeof ProductionBlocker>;

/** Remaining production blockers for Secure Automation L2A go-live. */
export const SECURE_AUTOMATION_PRODUCTION_BLOCKERS: readonly ProductionBlocker[] =
  [
    {
      id: 'AIO-16',
      severity: 'P0',
      title: 'Model provider access',
      detail:
        'IE-002 model_access remains blocked until a verified provider configuration exists. Intake/package selection must stay unblocked.',
      blocks: ['activation_ready', 'OL-001 supervised missions', 'L2A research/enrich quality'],
    },
    {
      id: 'AIO-17',
      severity: 'P0',
      title: 'Live GoHighLevel integration',
      detail:
        'GHL probes are config-presence only. Live location auth, CRM mutations against production GHL, and appointment/calendar services are not certified.',
      blocks: [
        'ghl_connection verified for production',
        'crm.* live side effects',
        'calendar appointment booking automation',
      ],
    },
    {
      id: 'SEND-GATE',
      severity: 'P0',
      title: 'Customer message send remains gated',
      detail:
        'L2A v1 intentionally excludes crm.message.send. Autonomous customer messaging stays prohibited until approved communication rules + R3 approval path are proven in production.',
      blocks: ['autonomous follow-up send', 'client claims of AI messaging'],
    },
    {
      id: 'WORKFLOW-ACTIVATION',
      severity: 'P0',
      title: 'Automatic workflow activation deferred',
      detail:
        'IE-002 workflow_activation stays blocked until acceptance tests + monitoring are ready and a human activates the case.',
      blocks: ['deliveryStatus=active', 'unattended L2A operation'],
    },
    {
      id: 'OL-001-COUNT',
      severity: 'P1',
      title: 'IE work is not OL-001 mission credit',
      detail:
        'Blueprint/provisioning progress must not be counted toward the 100-mission OL-001 cohort.',
      blocks: ['premature OL-001 completion claims'],
    },
    {
      id: 'CLAIM-VERIFY',
      severity: 'P1',
      title: 'Vendor/regulatory claims unverified',
      detail:
        'Offer-catalog and external brief statements about vendors, compliance regimes, or guaranteed outcomes are research inputs only until legal/ops verification.',
      blocks: ['client-facing compliance claims', 'guaranteed appointment/revenue claims'],
    },
  ];

export const ResearchCaveat = z.object({
  topic: z.string().min(1),
  sourceClass: z.enum([
    'internal_offer_catalog',
    'external_brief',
    'vendor_marketing',
    'regulatory_reference',
  ]),
  statement: z.string().min(1),
  status: z.literal('unverified_research_input'),
  requiredBeforeClientClaim: z.string().min(1),
});
export type ResearchCaveat = z.infer<typeof ResearchCaveat>;

/**
 * Explicit non-claims. Do not promote these to client-facing guarantees.
 */
export const SECURE_AUTOMATION_RESEARCH_CAVEATS: readonly ResearchCaveat[] = [
  {
    topic: 'Lead → Appointment commercial promise',
    sourceClass: 'internal_offer_catalog',
    statement:
      'Offer catalog positions AION as building repeatable Lead → Appointment → Customer systems with AI appointment setters.',
    status: 'unverified_research_input',
    requiredBeforeClientClaim:
      'Production L2A evidence under SA-STD-001 with measured conversion vs dated baseline for the specific client.',
  },
  {
    topic: 'Vendor capability statements',
    sourceClass: 'external_brief',
    statement:
      'Brief may assert third-party vendor features, certifications, or readiness levels.',
    status: 'unverified_research_input',
    requiredBeforeClientClaim:
      'Primary-source vendor docs + live integration proof in the target tenant workspace.',
  },
  {
    topic: 'Regulatory / compliance posture',
    sourceClass: 'regulatory_reference',
    statement:
      'Brief may imply TCPA, CAN-SPAM, GDPR, or industry-specific messaging compliance coverage.',
    status: 'unverified_research_input',
    requiredBeforeClientClaim:
      'Counsel-reviewed communication rules bound into the tenant policy pack before any send capability is enabled.',
  },
];

export interface SecureAutomationStandardSnapshot {
  standardId: typeof SECURE_AUTOMATION_STANDARD_ID;
  standardVersion: typeof SECURE_AUTOMATION_STANDARD_VERSION;
  controls: readonly SecureAutomationControl[];
  workflows: readonly SecureAutomationWorkflow[];
  olVerification: readonly OlVerificationMapping[];
  productionBlockers: readonly ProductionBlocker[];
  researchCaveats: readonly ResearchCaveat[];
}

export function getSecureAutomationStandard(): SecureAutomationStandardSnapshot {
  return {
    standardId: SECURE_AUTOMATION_STANDARD_ID,
    standardVersion: SECURE_AUTOMATION_STANDARD_VERSION,
    controls: SECURE_AUTOMATION_CONTROLS,
    workflows: SECURE_AUTOMATION_WORKFLOWS,
    olVerification: OL_VERIFICATION_MAP,
    productionBlockers: SECURE_AUTOMATION_PRODUCTION_BLOCKERS,
    researchCaveats: SECURE_AUTOMATION_RESEARCH_CAVEATS,
  };
}

/** Blueprint fields derived from a Secure Automation workflow. */
export interface SecureAutomationBlueprintOverlay {
  firstWorkflow: {
    name: string;
    inputs: string[];
    outputs: string[];
  };
  allowedActions: string[];
  prohibitedActions: string[];
  humanApprovalPoints: string[];
  acceptanceTests: string[];
  baselineKpi: string;
  targetKpi: string;
  measurementSource: string;
  secureAutomation: SecureAutomationProfile;
}

export function blueprintOverlayFromWorkflow(
  workflow: SecureAutomationWorkflow = LEAD_TO_APPOINTMENT_V1,
): SecureAutomationBlueprintOverlay {
  return {
    firstWorkflow: {
      name: workflow.label,
      inputs: [...workflow.inputs],
      outputs: [...workflow.outputs],
    },
    allowedActions: [
      'create_implementation_records',
      'run_approved_workflow_steps',
      'request_human_approval',
      `execute_workflow:${workflow.workflowId}`,
      ...workflow.permissions.filter((p) => !workflow.prohibitedCapabilities.includes(p)),
    ],
    prohibitedActions: [
      'autonomous_customer_messaging',
      'automatic_workflow_activation_without_acceptance',
      'commercial_expansion_triggers_without_human_review',
      ...workflow.prohibitedCapabilities,
    ],
    humanApprovalPoints: [
      'package_recommendation_review',
      'blueprint_approval',
      'workflow_activation',
      'crm_opportunity_create',
      'crm_message_draft',
      'human_appointment_book',
    ],
    acceptanceTests: [
      'Tenant isolation deny without x-aion-tenant-id',
      'Scoped permissions: only L2A allow-list capabilities may execute',
      'crm.message.send blocked under L2A v1 communication rules',
      'External mutation retries reuse ExternalSideEffect idempotency keys',
      'Provisioning recovery does not recreate tenant/workspace/workflow',
      'Outcome + cost units recorded for completed L2A run',
      'Failure path preserves completed provisioning evidence',
    ],
    baselineKpi: workflow.baselineKpiDefault,
    targetKpi: workflow.targetKpiDefault,
    measurementSource: workflow.measurementSourceDefault,
    secureAutomation: buildSecureAutomationProfile(workflow),
  };
}
