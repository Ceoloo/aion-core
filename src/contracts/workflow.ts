import { z } from 'zod';
import { WorkflowId } from './identifiers.js';
import { Capability } from './capability.js';
import { RiskLevel } from './risk.js';

/**
 * Workflow contract.
 *
 * A Workflow is a *reusable definition*; a Run (see run.ts) is *one execution*
 * of that definition. Keeping the two separate is a load-bearing distinction —
 * the definition is stable and shared, the run is a specific, traceable
 * instance.
 *
 * Phase 1 keeps the definition minimal: a workflow is a named, ordered list of
 * steps, each requiring a capability. The orchestrator in Phase 1 processes a
 * single command per run; the workflow contract exists so multi-step
 * definitions can be introduced without reshaping the run model.
 */
export const WorkflowStep = z.object({
  name: z.string().min(1),
  capability: Capability,
  /** The step's baseline risk; the policy engine may classify higher. */
  riskLevel: RiskLevel.default('R1'),
  description: z.string().optional(),
});
export type WorkflowStep = z.infer<typeof WorkflowStep>;

export const Workflow = z.object({
  workflowId: WorkflowId,
  name: z.string().min(1),
  description: z.string().default(''),
  version: z.string().default('1.0.0'),
  steps: z.array(WorkflowStep).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type Workflow = z.infer<typeof Workflow>;
