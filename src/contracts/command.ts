import { z } from 'zod';
import {
  CommandId,
  RequestId,
  MissionId,
  WorkflowId,
  ToolId,
} from './identifiers.js';
import { Capability } from './capability.js';
import { Actor } from './actor.js';
import { RiskLevel } from './risk.js';

/**
 * Command contract.
 *
 * Commands represent *intent* — a requested action ("SendProposal",
 * "ResearchProspect"). They are the input to the control plane and must never
 * be confused with events, which represent completed facts
 * (aion-docs/engineering/event-standards.md).
 *
 * A command names the capability it requires; the policy engine decides whether
 * the actor may perform it, at what risk, and whether a human gate applies. The
 * `riskLevel` here is the *caller-declared* risk — the control plane classifies
 * centrally and never lowers it.
 */
export const Command = z.object({
  commandId: CommandId,
  /** The originating request; anchors the whole trace. */
  requestId: RequestId,
  /** The mission this command serves, if any. */
  missionId: MissionId.optional(),
  /** The workflow this command belongs to, if any. */
  workflowId: WorkflowId.optional(),
  /** A stable, human-readable command name, e.g. "ResearchProspect". */
  name: z.string().min(1),
  /** Who is requesting the action. Required — no anonymous work. */
  actor: Actor,
  /** The capability required to perform the command. */
  capability: Capability,
  /** The specific tool requested, if the caller targets one. */
  toolId: ToolId.optional(),
  /** Opaque, capability-specific request data. */
  payload: z.record(z.unknown()).default({}),
  /** Caller-declared risk; the policy engine may classify higher. */
  riskLevel: RiskLevel.optional(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});
export type Command = z.infer<typeof Command>;

/**
 * The shape a caller supplies to the orchestrator. IDs and timestamps that the
 * control plane is responsible for minting are optional here and filled in by
 * the orchestrator, keeping the public API ergonomic while the stored
 * {@link Command} is always fully-formed.
 */
export interface CommandInput {
  name: string;
  actor: Actor;
  capability: Capability;
  requestId?: RequestId;
  missionId?: MissionId;
  workflowId?: WorkflowId;
  toolId?: ToolId;
  payload?: Record<string, unknown>;
  riskLevel?: RiskLevel;
  metadata?: Record<string, unknown>;
}
