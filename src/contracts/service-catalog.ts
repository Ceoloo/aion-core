import { capability } from './capability.js';
import {
  formatServiceKey,
  ServiceDefinition,
  type ServiceDefinition as ServiceDefinitionType,
} from './service.js';
import { newServiceId } from './identifiers.js';

/**
 * Mission 001 (Revenue) Service Catalog v0 seed.
 *
 * Lead/outreach services plus live-call Copilot engines. Media services land
 * in Mission 002 — not before.
 */
export const MISSION_001_SERVICE_KEYS = [
  // Outbound / pipeline
  'revenue.lead.research@1',
  'revenue.lead.enrich@1',
  'revenue.lead.score@1',
  'revenue.outreach.generate@1',
  'revenue.followup.execute@1',
  // Live-call Copilot engines (Week 3)
  'revenue.context@1',
  'revenue.extraction@1',
  'revenue.conversationstate@1',
  'revenue.signals@1',
  'revenue.objection@1',
  'revenue.nextaction@1',
] as const;

export type Mission001ServiceKey = (typeof MISSION_001_SERVICE_KEYS)[number];

const MISSION_001_SPECS: ReadonlyArray<{
  name: string;
  version: number;
  description: string;
  riskLevel: 'R0' | 'R1' | 'R2' | 'R3';
  approvalRequired: boolean;
}> = [
  {
    name: 'revenue.lead.research',
    version: 1,
    description: 'Research a prospect / account for outbound qualification.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.lead.enrich',
    version: 1,
    description: 'Enrich a lead with firmographic / contact attributes.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.lead.score',
    version: 1,
    description: 'Score a lead against ICP / pipeline criteria.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.outreach.generate',
    version: 1,
    description: 'Generate outbound outreach copy / sequence draft.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.followup.execute',
    version: 1,
    description: 'Execute a follow-up step (may touch external channels).',
    riskLevel: 'R2',
    approvalRequired: true,
  },
  {
    name: 'revenue.context',
    version: 1,
    description: 'Interpret live-call context for the Revenue Copilot.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.extraction',
    version: 1,
    description: 'Extract structured facts from a live sales turn.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.conversationstate',
    version: 1,
    description: 'Classify conversation stage / ladder position.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.signals',
    version: 1,
    description: 'Detect buying signals in a live conversation.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.objection',
    version: 1,
    description: 'Interpret objections and suggest handling.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'revenue.nextaction',
    version: 1,
    description: 'Recommend the next best revenue action for the rep.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
];

/** Build Mission 001 ServiceDefinition records (stable keys, fresh serviceIds). */
export function buildMission001Catalog(): ServiceDefinitionType[] {
  return MISSION_001_SPECS.map((spec) =>
    ServiceDefinition.parse({
      serviceId: newServiceId(),
      serviceKey: formatServiceKey(spec.name, spec.version),
      name: spec.name,
      version: spec.version,
      capability: capability(spec.name),
      owner: 'aion-systems/revenue',
      description: spec.description,
      requiredPermissions: [capability(spec.name)],
      agentCompatibility: ['agent://aion/revenue/', 'revenue'],
      riskLevel: spec.riskLevel,
      approvalRequired: spec.approvalRequired,
      evalRefs: [`eval.${spec.name}@1`],
      consumers: ['revenue-copilot', 'mission-001'],
      status: 'active',
      metadata: { mission: '001', catalog: 'v0' },
    }),
  );
}

/**
 * Mission 002 (Media / G-Star) Service Catalog v0 seed.
 *
 * Same ServiceDefinition contract as Mission 001 — no Core redesign.
 * Proves Revenue and Media share one Execution Platform.
 */
export const MISSION_002_SERVICE_KEYS = [
  'media.trend.research@1',
  'media.concept.generate@1',
  'media.script.generate@1',
  'media.asset.produce@1',
  'media.post.publish@1',
  'media.performance.ingest@1',
] as const;

export type Mission002ServiceKey = (typeof MISSION_002_SERVICE_KEYS)[number];

const MISSION_002_SPECS: ReadonlyArray<{
  name: string;
  version: number;
  description: string;
  riskLevel: 'R0' | 'R1' | 'R2' | 'R3';
  approvalRequired: boolean;
}> = [
  {
    name: 'media.trend.research',
    version: 1,
    description: 'Research trends / distribution opportunities for CEO LOO / G-Star.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'media.concept.generate',
    version: 1,
    description: 'Generate media concepts from research for G-Star / AION Media.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'media.script.generate',
    version: 1,
    description: 'Generate a script / copy draft from an approved concept.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'media.asset.produce',
    version: 1,
    description: 'Produce a media asset (stub adapter; real render later).',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'media.post.publish',
    version: 1,
    description: 'Publish / schedule a post to distribution channels (human gate).',
    riskLevel: 'R2',
    approvalRequired: true,
  },
  {
    name: 'media.performance.ingest',
    version: 1,
    description: 'Ingest distribution performance metrics for evaluation / cost-outcome.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
];

/** Build Mission 002 ServiceDefinition records (stable keys, fresh serviceIds). */
export function buildMission002Catalog(): ServiceDefinitionType[] {
  return MISSION_002_SPECS.map((spec) =>
    ServiceDefinition.parse({
      serviceId: newServiceId(),
      serviceKey: formatServiceKey(spec.name, spec.version),
      name: spec.name,
      version: spec.version,
      capability: capability(spec.name),
      owner: 'aion-systems/media',
      description: spec.description,
      requiredPermissions: [capability(spec.name)],
      agentCompatibility: ['agent://aion/media/', 'media', 'agent://aion/gstar/', 'gstar'],
      riskLevel: spec.riskLevel,
      approvalRequired: spec.approvalRequired,
      evalRefs: [`eval.${spec.name}@1`],
      consumers: ['mission-002', 'aion-media', 'g-star'],
      status: 'active',
      metadata: { mission: '002', catalog: 'v0' },
    }),
  );
}

/**
 * Mission 009 — live CRM / GoHighLevel client-money plane (commercially
 * meaningful workflow; payment movement explicitly out of MVP).
 *
 * Agents never call GHL directly — Runtime adapters invoke these services
 * under identity, tenant, permission, risk, autonomy, approval, and budget.
 */
export const MISSION_009_SERVICE_KEYS = [
  'crm.contact.read@1',
  'crm.contact.enrich@1',
  'crm.contact.update@1',
  'crm.opportunity.read@1',
  'crm.opportunity.create@1',
  'crm.opportunity.update@1',
  'crm.note.create@1',
  'crm.task.create@1',
  'crm.message.draft@1',
  'crm.message.send@1',
] as const;

export type Mission009ServiceKey = (typeof MISSION_009_SERVICE_KEYS)[number];

const MISSION_009_SPECS: ReadonlyArray<{
  name: string;
  version: number;
  description: string;
  riskLevel: 'R0' | 'R1' | 'R2' | 'R3';
  approvalRequired: boolean;
}> = [
  {
    name: 'crm.contact.read',
    version: 1,
    description: 'Read a contact from the tenant CRM workspace (GHL).',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'crm.contact.enrich',
    version: 1,
    description: 'Enrich a CRM contact with research attributes (reversible write).',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'crm.contact.update',
    version: 1,
    description: 'Update permitted CRM contact fields in the tenant workspace.',
    riskLevel: 'R2',
    approvalRequired: true,
  },
  {
    name: 'crm.opportunity.read',
    version: 1,
    description: 'Read an opportunity / pipeline record from the tenant CRM.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'crm.opportunity.create',
    version: 1,
    description: 'Create an opportunity in the tenant CRM (idempotent).',
    riskLevel: 'R2',
    approvalRequired: true,
  },
  {
    name: 'crm.opportunity.update',
    version: 1,
    description: 'Update an opportunity in the tenant CRM.',
    riskLevel: 'R2',
    approvalRequired: true,
  },
  {
    name: 'crm.note.create',
    version: 1,
    description: 'Create a CRM note on a contact / opportunity.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'crm.task.create',
    version: 1,
    description: 'Create a CRM task in the tenant workspace.',
    riskLevel: 'R1',
    approvalRequired: false,
  },
  {
    name: 'crm.message.draft',
    version: 1,
    description: 'Draft a customer-facing follow-up message (no send).',
    riskLevel: 'R2',
    approvalRequired: true,
  },
  {
    name: 'crm.message.send',
    version: 1,
    description: 'Send a customer-facing message via CRM (always gated; R3).',
    riskLevel: 'R3',
    approvalRequired: true,
  },
];

/** Build Mission 009 CRM ServiceDefinition records. */
export function buildMission009Catalog(): ServiceDefinitionType[] {
  return MISSION_009_SPECS.map((spec) =>
    ServiceDefinition.parse({
      serviceId: newServiceId(),
      serviceKey: formatServiceKey(spec.name, spec.version),
      name: spec.name,
      version: spec.version,
      capability: capability(spec.name),
      owner: 'aion-systems/revenue',
      description: spec.description,
      requiredPermissions: [capability(spec.name)],
      agentCompatibility: ['agent://aion/revenue/', 'revenue', 'agent://aion/crm/', 'crm'],
      riskLevel: spec.riskLevel,
      approvalRequired: spec.approvalRequired,
      evalRefs: [`eval.${spec.name}@1`],
      consumers: ['mission-009', 'revenue-copilot', 'ghl-client-plane'],
      status: 'active',
      metadata: { mission: '009', catalog: 'v0', provider: 'ghl' },
    }),
  );
}
