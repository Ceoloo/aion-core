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
