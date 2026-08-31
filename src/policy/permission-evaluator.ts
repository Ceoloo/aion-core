import type { Actor } from '../contracts/actor.js';
import type { Capability } from '../contracts/capability.js';
import type { ToolId } from '../contracts/identifiers.js';

/** Result of a single permission check. */
export interface PermissionCheck {
  permitted: boolean;
  reason: string;
}

/**
 * PermissionEvaluator.
 *
 * Deny-by-default authorization (aion-docs/governance/permissions.md): an actor
 * may perform a capability only if it is in the actor's granted `permissions`
 * and NOT in its `forbiddenCapabilities`. Forbidden always wins over a grant.
 * A requested tool must be in the actor's `allowedTools`.
 *
 * This evaluator is pure and deterministic; it self-grants nothing and enforces
 * centrally on behalf of the control plane.
 */
export class PermissionEvaluator {
  /** Is the actor permitted to perform this capability? */
  evaluateCapability(actor: Actor, capability: Capability): PermissionCheck {
    if (actor.forbiddenCapabilities.includes(capability)) {
      return {
        permitted: false,
        reason: `capability "${capability}" is explicitly forbidden for actor "${actor.name}"`,
      };
    }
    if (!actor.permissions.includes(capability)) {
      return {
        permitted: false,
        reason: `actor "${actor.name}" is not granted capability "${capability}" (deny by default)`,
      };
    }
    return {
      permitted: true,
      reason: `actor "${actor.name}" is granted capability "${capability}"`,
    };
  }

  /** Is the actor permitted to use this tool? */
  evaluateTool(actor: Actor, toolId: ToolId): PermissionCheck {
    if (!actor.allowedTools.includes(toolId)) {
      return {
        permitted: false,
        reason: `actor "${actor.name}" is not permitted to use tool "${toolId}"`,
      };
    }
    return {
      permitted: true,
      reason: `actor "${actor.name}" is permitted to use tool "${toolId}"`,
    };
  }
}
