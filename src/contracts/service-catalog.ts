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
 * Only these five services are registered until Mission 001 proves the
 * platform. Media services land in Mission 002 — not before.
 */
export const MISSION_001_SERVICE_KEYS = [
  'revenue.lead.research@1',
  'revenue.lead.enrich@1',
  'revenue.lead.score@1',
  'revenue.outreach.generate@1',
  'revenue.followup.execute@1',
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
