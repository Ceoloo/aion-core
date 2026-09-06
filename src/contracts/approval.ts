import { z } from 'zod';
import {
  ApprovalId,
  RunId,
  RequestId,
  MissionId,
  ActorId,
  ExecutionId,
} from './identifiers.js';
import { RiskLevel } from './risk.js';
import { Command } from './command.js';

/**
 * Approval contract (human gate).
 *
 * When policy returns REQUIRE_APPROVAL the run pauses and an ApprovalRequest is
 * created. The request carries enough context for a human to decide without
 * reconstructing state (aion-docs/governance/human-gates.md): the proposed
 * command, its risk level, and why the gate fired.
 *
 * Gates fail safe: no approval → no action. The stored command lets the SAME
 * run resume on approval rather than spawning an unrelated second execution.
 */
export const APPROVAL_STATUSES = [
  'pending',
  'granted',
  'rejected',
] as const;
export const ApprovalStatus = z.enum(APPROVAL_STATUSES);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

export const ApprovalRequest = z.object({
  approvalId: ApprovalId,
  /** The run this gate pauses — approval resumes exactly this run. */
  runId: RunId,
  requestId: RequestId,
  missionId: MissionId.optional(),
  /**
   * Mission 003: approvals are bound to a single execution. Using an approval
   * from execution A against execution B is DENY.
   */
  executionId: ExecutionId.optional(),
  /** Tenant that owns this approval — cross-tenant reuse is DENY. */
  tenantId: z.string().min(1).optional(),
  /** The full proposed action, so the run can resume deterministically. */
  command: Command,
  /** The centrally classified risk that triggered the gate. */
  riskLevel: RiskLevel,
  /** Why approval is required (from the policy decision). */
  reason: z.string(),
  status: ApprovalStatus.default('pending'),
  requestedAt: z.string().datetime(),
  /** Set when a decision is recorded. */
  decidedAt: z.string().datetime().optional(),
  /** The human identity that decided. A worker never approves its own gate. */
  decidedBy: ActorId.optional(),
  /** Optional free-text note from the approver. */
  note: z.string().optional(),
  /** After this timestamp the approval is invalid (stale / expired). */
  expiresAt: z.string().datetime().optional(),
  /** Once consumed for execute, cannot be replayed. */
  consumedAt: z.string().datetime().optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

/** A human's decision on a pending gate. */
export const ApprovalDecision = z.object({
  approvalId: ApprovalId,
  approve: z.boolean(),
  /** The human deciding. Must differ from the run's worker identity. */
  decidedBy: ActorId,
  note: z.string().optional(),
});
export type ApprovalDecision = z.infer<typeof ApprovalDecision>;
