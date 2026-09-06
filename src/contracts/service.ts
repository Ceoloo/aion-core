import { z } from 'zod';
import { ServiceId, ToolId, WorkflowId } from './identifiers.js';
import { Capability } from './capability.js';
import { RiskLevel } from './risk.js';

/**
 * Service Catalog entry — a versioned, invocable AION capability.
 *
 * Agents do not call departments or raw tools. They invoke **services**
 * (`revenue.lead.research@1`). The catalog resolves service → capability →
 * permissions → tools/workflow → execution → eval (Execution Platform v1 §7).
 *
 * `serviceKey` carries the `@version` suffix; `capability` stays Capability-legal
 * (dotted path, no `@`) so policy and adapters keep one taxonomy.
 */

/** `name@version`, e.g. `revenue.lead.research@1`. */
export const SERVICE_KEY_PATTERN =
  /^([a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+)@([1-9][0-9]*)$/;

export const ServiceKey = z
  .string()
  .regex(SERVICE_KEY_PATTERN, 'serviceKey must be name@version, e.g. revenue.lead.research@1');
export type ServiceKey = z.infer<typeof ServiceKey>;

export const SERVICE_STATUSES = ['active', 'deprecated'] as const;
export const ServiceStatus = z.enum(SERVICE_STATUSES);
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const ServiceDefinition = z.object({
  serviceId: ServiceId,
  /** Canonical invocable key: `{name}@{version}`. */
  serviceKey: ServiceKey,
  /** Unversioned dotted name (matches capability for Mission 001 services). */
  name: z.string().min(1),
  version: z.number().int().positive(),
  /** Policy/adapter capability (no `@version`). */
  capability: Capability,
  /** Accountable owner (team / mission / product). */
  owner: z.string().min(1),
  description: z.string().optional(),
  inputSchemaRef: z.string().optional(),
  outputSchemaRef: z.string().optional(),
  requiredPermissions: z.array(Capability).default([]),
  /** Agent URI prefixes or roles that may invoke this service. */
  agentCompatibility: z.array(z.string()).default([]),
  tools: z.array(ToolId).default([]),
  riskLevel: RiskLevel.default('R1'),
  approvalRequired: z.boolean().default(false),
  costHintUnits: z.number().nonnegative().optional(),
  slaHint: z.string().optional(),
  evalRefs: z.array(z.string()).default([]),
  consumers: z.array(z.string()).default([]),
  workflowId: WorkflowId.optional(),
  status: ServiceStatus.default('active'),
  metadata: z.record(z.unknown()).default({}),
});
export type ServiceDefinition = z.infer<typeof ServiceDefinition>;

export interface ServiceKeyParts {
  name: string;
  version: number;
}

export function formatServiceKey(name: string, version: number): ServiceKey {
  return ServiceKey.parse(`${name}@${version}`);
}

export function parseServiceKey(key: string): ServiceKeyParts {
  const parsed = ServiceKey.parse(key);
  const match = SERVICE_KEY_PATTERN.exec(parsed);
  if (!match) {
    throw new Error(`invalid serviceKey: ${key}`);
  }
  return { name: match[1]!, version: Number(match[2]) };
}
