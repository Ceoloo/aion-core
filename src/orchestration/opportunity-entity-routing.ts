/**
 * Lead-to-Appointment entity-state routing for opportunities.
 *
 * Workflow templates may declare `crm.opportunity.create` as the opportunity
 * step. When the step payload already carries a real CRM opportunity id, the
 * correct operation is update — create would ignore the id and attempt a
 * duplicate opportunity (missing pipeline/stage).
 *
 * Not a new workflow version: same L2A intent, corrected entity-state handling.
 */

import { capability, type Capability } from '../contracts/capability.js';

const CREATE = 'crm.opportunity.create';
const UPDATE = 'crm.opportunity.update';

function stripVersion(cap: string): string {
  const at = cap.lastIndexOf('@');
  return at > 0 ? cap.slice(0, at) : cap;
}

export function existingOpportunityId(
  payload: Record<string, unknown> | undefined,
): string | undefined {
  if (!payload) return undefined;
  for (const key of ['opportunityId', 'ghlOpportunityId'] as const) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * If the declared capability is opportunity.create and payload has an
 * opportunity id, route to opportunity.update. Otherwise return declared.
 */
export function resolveOpportunityCapability(
  declared: Capability,
  payload: Record<string, unknown> | undefined,
): Capability {
  if (stripVersion(declared) !== CREATE) return declared;
  if (!existingOpportunityId(payload)) return declared;
  return capability(UPDATE);
}
