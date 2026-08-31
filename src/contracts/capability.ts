import { z } from 'zod';

/**
 * A capability represents something an actor or executor can do — a verb the
 * system understands, independent of who performs it or which runtime backs it.
 *
 * Capabilities use a dotted `domain.action` taxonomy, e.g. `research.web`,
 * `code.modify`, `email.send`, `deployment.execute`. These are *taxonomy
 * illustrations*, not integrations — Phase 1 implements none of the underlying
 * behaviours; it proves that policy can reason about them.
 *
 * A capability is the unit that:
 *  - an actor is granted (permissions) or denied (forbidden actions);
 *  - a tool provides;
 *  - an execution adapter advertises it can handle;
 *  - the policy engine authorizes.
 */
export const Capability = z
  .string()
  .min(1)
  .regex(
    /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/,
    'capability must be a dotted lower-case taxonomy path, e.g. "research.web"',
  )
  .brand('Capability');
export type Capability = z.infer<typeof Capability>;

/** Narrowing helper for constructing a capability from a literal. */
export function capability(value: string): Capability {
  return Capability.parse(value);
}
