import type { ApprovalStore } from '../ports/approval-store.js';
import type {
  ApprovalRequest,
  ApprovalDecision,
} from '../contracts/approval.js';
import type { Command } from '../contracts/command.js';
import type { PolicyDecision } from '../contracts/policy.js';
import type { RunId, ApprovalId } from '../contracts/identifiers.js';
import { newApprovalId } from '../contracts/identifiers.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';
import {
  NotFoundError,
  InvalidStateTransitionError,
  PermissionDeniedError,
} from '../errors/index.js';

/**
 * ApprovalGate.
 *
 * The human-gate abstraction (aion-docs/governance/human-gates.md). It creates
 * gate requests when policy demands one and records human decisions, enforcing
 * the invariants:
 *
 *  - **Fails safe** — a run only proceeds on an explicit `granted`.
 *  - **A worker never approves its own gate** — the approver's identity must
 *    differ from the run's worker identity.
 *  - **Carries enough context to decide** — the request stores the proposed
 *    command and its risk, so approval can resume the exact original run.
 *
 * Phase 1 has no UI/Slack/email; the gate proves the contract in-memory.
 */
export class ApprovalGate {
  constructor(
    private readonly store: ApprovalStore,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Create a pending gate for a paused run. */
  async request(
    command: Command,
    runId: RunId,
    decision: PolicyDecision,
    binding: {
      executionId?: ApprovalRequest['executionId'];
      tenantId?: string;
      expiresAt?: string;
    } = {},
  ): Promise<ApprovalRequest> {
    const request: ApprovalRequest = {
      approvalId: newApprovalId(),
      runId,
      requestId: command.requestId,
      ...(command.missionId ? { missionId: command.missionId } : {}),
      ...(binding.executionId ? { executionId: binding.executionId } : {}),
      ...(binding.tenantId ? { tenantId: binding.tenantId } : {}),
      ...(binding.expiresAt ? { expiresAt: binding.expiresAt } : {}),
      command,
      riskLevel: decision.riskLevel,
      reason: decision.reason,
      status: 'pending',
      requestedAt: this.clock.isoNow(),
    };
    await this.store.save(request);
    return request;
  }

  /**
   * Mark a granted approval as consumed after a successful gated execute.
   * Replay of a consumed approvalId is DENY (Mission 003).
   */
  async consume(approvalId: ApprovalId): Promise<ApprovalRequest> {
    const existing = await this.store.get(approvalId);
    if (!existing) {
      throw new NotFoundError(
        `approval request "${approvalId}" not found`,
        { approvalId },
      );
    }
    if (existing.status !== 'granted') {
      throw new InvalidStateTransitionError(
        `approval "${approvalId}" must be granted before consume (is ${existing.status})`,
        { approvalId, status: existing.status },
      );
    }
    if (existing.consumedAt) {
      throw new InvalidStateTransitionError(
        `approval "${approvalId}" already consumed`,
        { approvalId, consumedAt: existing.consumedAt },
      );
    }
    const updated: ApprovalRequest = {
      ...existing,
      consumedAt: this.clock.isoNow(),
    };
    await this.store.save(updated);
    return updated;
  }

  async get(id: ApprovalId): Promise<ApprovalRequest | undefined> {
    return this.store.get(id);
  }

  /**
   * Record a human decision on a pending gate. Returns the updated request.
   * Throws if the gate is unknown, already decided, or if the approver is the
   * run's own worker.
   */
  async decide(decision: ApprovalDecision): Promise<ApprovalRequest> {
    const existing = await this.store.get(decision.approvalId);
    if (!existing) {
      throw new NotFoundError(
        `approval request "${decision.approvalId}" not found`,
        { approvalId: decision.approvalId },
      );
    }
    if (existing.status !== 'pending') {
      throw new InvalidStateTransitionError(
        `approval "${decision.approvalId}" is already ${existing.status}`,
        { approvalId: decision.approvalId, status: existing.status },
      );
    }
    if (decision.decidedBy === existing.command.actor.actorId) {
      throw new PermissionDeniedError(
        'a worker cannot approve its own gate',
        {
          approvalId: decision.approvalId,
          decidedBy: decision.decidedBy,
        },
      );
    }

    const updated: ApprovalRequest = {
      ...existing,
      status: decision.approve ? 'granted' : 'rejected',
      decidedAt: this.clock.isoNow(),
      decidedBy: decision.decidedBy,
      ...(decision.note ? { note: decision.note } : {}),
    };
    await this.store.save(updated);
    return updated;
  }
}
