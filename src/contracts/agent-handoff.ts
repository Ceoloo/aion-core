import { z } from 'zod';
import {
  AgentId,
  CorrelationId,
  ExecutionId,
  HandoffId,
  MissionId,
  RunId,
  newHandoffId,
} from './identifiers.js';

/**
 * Agent-to-agent handoff contract.
 *
 * Agents must not forward chat transcripts as context. They exchange a
 * structured handoff: facts, uncertainties, artifact references, and an
 * overall confidence score. Deterministic software remains preferred when it
 * is sufficient; this payload is for governed delegation when adaptive work
 * crosses an agent boundary (AI / Agent Engineer ownership).
 *
 * Cursor markdown templates in aion-docs/.aion/handoffs render the same
 * fields for human specialists. Runtime may transport this object as a
 * Command payload or ExecutionResult.output — it must not redefine it.
 *
 * schemaVersion is fixed at "1" so receivers can reject unknown shapes.
 */

export const AGENT_HANDOFF_SCHEMA_VERSION = '1' as const;

export const AGENT_HANDOFF_KINDS = [
  /** End-of-slice completion for a peer or orchestrator. */
  'completion',
  /** Work requested of another agent (delegation). */
  'delegation',
  /** Blocking contract / dependency request between specialists. */
  'dependency',
] as const;
export const AgentHandoffKind = z.enum(AGENT_HANDOFF_KINDS);
export type AgentHandoffKind = z.infer<typeof AgentHandoffKind>;

export const AGENT_HANDOFF_STATUSES = [
  'open',
  'accepted',
  'rejected',
  'superseded',
  'closed',
] as const;
export const AgentHandoffStatus = z.enum(AGENT_HANDOFF_STATUSES);
export type AgentHandoffStatus = z.infer<typeof AgentHandoffStatus>;

/** Confidence in [0, 1] — shared by overall handoff and optional per-fact scores. */
export const ConfidenceScore = z.number().min(0).max(1);
export type ConfidenceScore = z.infer<typeof ConfidenceScore>;

/**
 * A stated fact the receiver may treat as established for this handoff.
 * Do not put guesses here — those belong in `uncertainties`.
 */
export const HandoffFact = z.object({
  /** Stable key when the fact maps to a vocabulary (optional). */
  key: z.string().min(1).optional(),
  statement: z.string().min(1),
  /** Optional per-fact confidence when it differs from the handoff overall. */
  confidence: ConfidenceScore.optional(),
  /** Pointers into `artifactRefs` (by `id`) or external evidence ids. */
  evidenceRefs: z.array(z.string().min(1)).default([]),
  source: z.string().min(1).optional(),
});
export type HandoffFact = z.infer<typeof HandoffFact>;

export const UNCERTAINTY_IMPACTS = ['low', 'medium', 'high'] as const;
export const UncertaintyImpact = z.enum(UNCERTAINTY_IMPACTS);
export type UncertaintyImpact = z.infer<typeof UncertaintyImpact>;

/** Something unknown, disputed, or insufficiently evidenced. */
export const HandoffUncertainty = z.object({
  statement: z.string().min(1),
  impact: UncertaintyImpact.default('medium'),
  /** When true, the receiver should not proceed as if the work is decided. */
  blocking: z.boolean().default(false),
  /** Question whose answer would resolve this uncertainty. */
  resolveBy: z.string().min(1).optional(),
});
export type HandoffUncertainty = z.infer<typeof HandoffUncertainty>;

export const ARTIFACT_REF_KINDS = [
  'file',
  'pr',
  'commit',
  'url',
  'execution',
  'schema',
  'mission',
  'eval',
  'run',
  'other',
] as const;
export const ArtifactRefKind = z.enum(ARTIFACT_REF_KINDS);
export type ArtifactRefKind = z.infer<typeof ArtifactRefKind>;

/**
 * Reference to an artifact — never an inline dump of chat or large blobs.
 * Prefer stable URIs / paths the receiver can fetch under least privilege.
 */
export const ArtifactRef = z.object({
  /** Local id within this handoff for evidenceRefs. */
  id: z.string().min(1),
  kind: ArtifactRefKind,
  /** URI, repo path, PR URL, execution id, etc. */
  ref: z.string().min(1),
  label: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
});
export type ArtifactRef = z.infer<typeof ArtifactRef>;

/**
 * Optional gates the receiver applies to `confidence`.
 * Below `escalateBelow` → human / orchestrator review.
 * At or above `autoAcceptAbove` → may accept without extra review (still within policy).
 */
export const ConfidenceGate = z
  .object({
    escalateBelow: ConfidenceScore.optional(),
    autoAcceptAbove: ConfidenceScore.optional(),
  })
  .refine(
    (g) =>
      g.escalateBelow === undefined ||
      g.autoAcceptAbove === undefined ||
      g.escalateBelow <= g.autoAcceptAbove,
    { message: 'escalateBelow must be <= autoAcceptAbove when both are set' },
  );
export type ConfidenceGate = z.infer<typeof ConfidenceGate>;

export const AgentHandoff = z.object({
  schemaVersion: z.literal(AGENT_HANDOFF_SCHEMA_VERSION),
  handoffId: HandoffId,
  kind: AgentHandoffKind,
  status: AgentHandoffStatus.default('open'),

  /** Sending agent (branded Core agent id when known). */
  fromAgentId: AgentId.optional(),
  /** Human-readable sender role/name when id is not yet assigned (Cursor specialists). */
  fromLabel: z.string().min(1).optional(),
  toAgentId: AgentId.optional(),
  toLabel: z.string().min(1).optional(),

  missionId: MissionId.optional(),
  runId: RunId.optional(),
  executionId: ExecutionId.optional(),
  correlationId: CorrelationId.optional(),
  parentHandoffId: HandoffId.optional(),

  /** Short need / objective for this handoff. */
  need: z.string().min(1),
  facts: z.array(HandoffFact).default([]),
  uncertainties: z.array(HandoffUncertainty).default([]),
  artifactRefs: z.array(ArtifactRef).default([]),
  /** Overall confidence that facts + recommendation are safe to act on. */
  confidence: ConfidenceScore,
  confidenceGate: ConfidenceGate.optional(),

  decisionNeeded: z.string().min(1).optional(),
  recommendedAction: z.string().min(1).optional(),
  /** Machine contract the receiver should implement against (field list, API, etc.). */
  contract: z.string().min(1).optional(),
  blocking: z.boolean().default(false),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type AgentHandoff = z.infer<typeof AgentHandoff>;

export interface CreateAgentHandoffInput {
  kind: AgentHandoffKind;
  need: string;
  confidence: number;
  facts?: Array<z.input<typeof HandoffFact>>;
  uncertainties?: Array<z.input<typeof HandoffUncertainty>>;
  artifactRefs?: Array<z.input<typeof ArtifactRef>>;
  fromAgentId?: AgentHandoff['fromAgentId'];
  fromLabel?: string;
  toAgentId?: AgentHandoff['toAgentId'];
  toLabel?: string;
  missionId?: AgentHandoff['missionId'];
  runId?: AgentHandoff['runId'];
  executionId?: AgentHandoff['executionId'];
  correlationId?: AgentHandoff['correlationId'];
  parentHandoffId?: AgentHandoff['parentHandoffId'];
  decisionNeeded?: string;
  recommendedAction?: string;
  contract?: string;
  blocking?: boolean;
  confidenceGate?: z.input<typeof ConfidenceGate>;
  status?: AgentHandoffStatus;
  handoffId?: HandoffId;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/** Mint a validated AgentHandoff with defaults. */
export function createAgentHandoff(input: CreateAgentHandoffInput): AgentHandoff {
  const createdAt = input.createdAt ?? new Date().toISOString();
  return AgentHandoff.parse({
    schemaVersion: AGENT_HANDOFF_SCHEMA_VERSION,
    handoffId: input.handoffId ?? newHandoffId(),
    kind: input.kind,
    status: input.status ?? 'open',
    ...(input.fromAgentId ? { fromAgentId: input.fromAgentId } : {}),
    ...(input.fromLabel ? { fromLabel: input.fromLabel } : {}),
    ...(input.toAgentId ? { toAgentId: input.toAgentId } : {}),
    ...(input.toLabel ? { toLabel: input.toLabel } : {}),
    ...(input.missionId ? { missionId: input.missionId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.executionId ? { executionId: input.executionId } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.parentHandoffId ? { parentHandoffId: input.parentHandoffId } : {}),
    need: input.need,
    facts: input.facts ?? [],
    uncertainties: input.uncertainties ?? [],
    artifactRefs: input.artifactRefs ?? [],
    confidence: input.confidence,
    ...(input.confidenceGate ? { confidenceGate: input.confidenceGate } : {}),
    ...(input.decisionNeeded ? { decisionNeeded: input.decisionNeeded } : {}),
    ...(input.recommendedAction
      ? { recommendedAction: input.recommendedAction }
      : {}),
    ...(input.contract ? { contract: input.contract } : {}),
    blocking: input.blocking ?? false,
    createdAt,
    metadata: input.metadata ?? {},
  });
}

export type HandoffReviewDisposition =
  | 'escalate'
  | 'accept'
  | 'proceed_with_caution';

/**
 * Apply confidence gates. Defaults: escalate below 0.5, auto-accept at/above 0.85.
 * Blocking uncertainties always escalate regardless of score.
 */
export function dispositionForHandoff(
  handoff: AgentHandoff,
  defaults: { escalateBelow?: number; autoAcceptAbove?: number } = {},
): HandoffReviewDisposition {
  if (handoff.uncertainties.some((u) => u.blocking)) {
    return 'escalate';
  }
  const escalateBelow =
    handoff.confidenceGate?.escalateBelow ?? defaults.escalateBelow ?? 0.5;
  const autoAcceptAbove =
    handoff.confidenceGate?.autoAcceptAbove ?? defaults.autoAcceptAbove ?? 0.85;
  if (handoff.confidence < escalateBelow) return 'escalate';
  if (handoff.confidence >= autoAcceptAbove) return 'accept';
  return 'proceed_with_caution';
}

/** True when the receiver should not treat the handoff as decided. */
export function handoffRequiresHumanReview(handoff: AgentHandoff): boolean {
  return dispositionForHandoff(handoff) === 'escalate';
}
