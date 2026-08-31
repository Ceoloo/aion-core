import { z } from 'zod';
import { ToolId } from './identifiers.js';
import { Capability } from './capability.js';
import { RiskLevel } from './risk.js';

/**
 * Tool contract.
 *
 * A Tool is an executable capability available to an execution environment. The
 * contract exists so the policy engine can decide whether a given actor may use
 * a given tool — it deliberately does NOT implement any real external tool
 * (that is out of Phase 1 scope).
 *
 * `inputSchemaRef` / `outputSchemaRef` are *references* (contract identifiers),
 * not embedded schemas: concrete data schemas are owned by aion-data, and Core
 * only needs to know a tool declares them.
 */
export const Tool = z.object({
  toolId: ToolId,
  name: z.string().min(1),
  /** The capability this tool provides. */
  capability: Capability,
  /** The tool's default risk level; an action may be classified higher. */
  riskLevel: RiskLevel.default('R1'),
  /** Reference to the input data contract (owned externally, e.g. aion-data). */
  inputSchemaRef: z.string().optional(),
  /** Reference to the output data contract. */
  outputSchemaRef: z.string().optional(),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type Tool = z.infer<typeof Tool>;
