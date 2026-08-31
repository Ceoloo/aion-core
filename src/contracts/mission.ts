import { z } from 'zod';
import { MissionId } from './identifiers.js';
import { RiskLevel } from './risk.js';

/**
 * Mission contract (minimal).
 *
 * A mission is the justification for work: nothing significant is built or run
 * without one (aion-docs/engineering/principles.md #7,
 * aion-docs/missions/lifecycle.md). This is intentionally NOT a project-
 * management schema — it carries only what current orchestration needs to
 * associate a run with the intent that authorized it.
 */

export const MISSION_STATUSES = [
  'draft',
  'active',
  'paused',
  'completed',
  'cancelled',
] as const;
export const MissionStatus = z.enum(MISSION_STATUSES);
export type MissionStatus = z.infer<typeof MissionStatus>;

export const Mission = z.object({
  missionId: MissionId,
  name: z.string().min(1),
  description: z.string().default(''),
  /** The human or team accountable for the mission. */
  owner: z.string().min(1),
  status: MissionStatus.default('active'),
  /** What outcome the mission is trying to produce. */
  objective: z.string().min(1),
  /** How success is judged (referenced by the evaluator, later phases). */
  successCriteria: z.array(z.string()).default([]),
  /** The mission's baseline risk level. */
  riskLevel: RiskLevel.default('R1'),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type Mission = z.infer<typeof Mission>;
