import { z } from 'zod';

/**
 * Autonomy levels (Execution Platform — earned autonomy, Mission 008).
 *
 * L0 — Observe: read / search / analyze only.
 * L1 — Recommend: plans/artifacts; no side effects without a human.
 * L2 — Execute reversible work within a narrow allow-list.
 * L3 — Execute sensitive work with approval.
 * L4 — Bounded autonomous execution: a *proven* scoped workflow may run
 *      without a human gate when evidence meets policy. Never unrestricted.
 *
 * Declared on the agent as a starting posture / ceiling hint. Earned levels
 * for a specific agent × service × tenant × environment live on AutonomyGrant
 * and are never raised by the worker itself.
 */
export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export const AutonomyLevel = z.enum(AUTONOMY_LEVELS);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;
