import { z } from 'zod';

/**
 * Autonomy levels (Execution Platform progress assessment — Week 1 policy).
 *
 * L0 — suggest only; a human must act.
 * L1 — draft / prepare; human commits.
 * L2 — act within a narrow allow-list; escalate otherwise.
 * L3 — act broadly within policy; human on exceptions.
 * L4 — full autonomy within hard budget/risk ceilings (rare; explicit grant).
 *
 * Autonomy is declared on the agent and may be tightened per execution. It is
 * never raised by the worker itself.
 */
export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export const AutonomyLevel = z.enum(AUTONOMY_LEVELS);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;
