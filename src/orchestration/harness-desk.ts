import type { AgentHandoff } from '../contracts/agent-handoff.js';
import { AgentHandoff as AgentHandoffSchema } from '../contracts/agent-handoff.js';
import type { Actor } from '../contracts/actor.js';
import type { Capability } from '../contracts/capability.js';
import type { CommandInput } from '../contracts/command.js';
import type { MissionId, RequestId, WorkItemId } from '../contracts/identifiers.js';
import { newRequestId, newWorkItemId } from '../contracts/identifiers.js';
import type { RiskLevel } from '../contracts/risk.js';
import { WorkItem } from '../contracts/work-item.js';
import {
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '../errors/index.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';
import type { OrchestrationResult, Orchestrator } from './orchestrator.js';

/**
 * HarnessDesk — in-process coordination for more than one harness.
 *
 * Four behaviors, one interface:
 *  1. The ticket is the message. A work item carries an AgentHandoff and
 *     nothing else across the harness boundary.
 *  2. Wakeups coalesce. Two heartbeats for the same ticket become one run.
 *  3. Checkout is exclusive. A second claim while a harness holds the ticket
 *     does not start a second run.
 *  4. Dispatch goes through the Orchestrator, so policy authorizes the command
 *     before any adapter runs. The adapter resumes `sessionId` and the
 *     provider stops at `budgetUnits`.
 *
 * This is not a broker. State lives in the desk. An indeterminate outcome
 * keeps the checkout until {@link HarnessDesk.reconcile} cancels it or retries
 * under the same idempotency key.
 */
export interface HarnessDeskDeps {
  orchestrator: Orchestrator;
  clock?: Clock;
}

export interface OpenWorkItemInput {
  /** The only message. A chat transcript is not accepted. */
  handoff: AgentHandoff;
  harnessId: string;
  actor: Actor;
  capability: Capability;
  /** Command name on the authorized command. Default "HarnessWork". */
  name?: string;
  missionId?: MissionId;
  stepName?: string;
  /** Resume this session instead of starting a new one. */
  sessionId?: string;
  budgetUnits?: number;
  model?: string;
  riskLevel?: RiskLevel;
}

export interface WakeResult {
  /** True when a wake for this ticket was already pending. */
  coalesced: boolean;
}

export interface HarnessPulseResult {
  /** Tickets dispatched through the orchestrator on this pulse. */
  dispatched: WorkItem[];
  /**
   * Tickets that already had a holder. The pulse did not run them again.
   * The coalesced wake stays pending until the holder releases.
   */
  held: WorkItemId[];
}

export type ReconcileAction = 'cancel' | 'retry';

const TERMINAL: ReadonlySet<WorkItem['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

export class HarnessDesk {
  private readonly clock: Clock;
  private readonly items = new Map<WorkItemId, WorkItem>();
  /** One pending wake per ticket. A second wake does not add a second entry. */
  private readonly pending = new Map<WorkItemId, true>();

  constructor(private readonly deps: HarnessDeskDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /** Persist a ticket and queue a single wake for its harness. */
  open(input: OpenWorkItemInput): WorkItem {
    const handoff = parseHandoff(input.handoff);
    if (input.harnessId.trim().length === 0) {
      throw new ValidationError('harnessId is required', { field: 'harnessId' });
    }
    const now = this.clock.isoNow();
    const item = WorkItem.parse(
      defined({
        workItemId: newWorkItemId(),
        status: 'queued',
        harnessId: input.harnessId,
        handoff,
        actor: input.actor,
        capability: input.capability,
        commandName: input.name ?? 'HarnessWork',
        missionId: input.missionId,
        stepName: input.stepName,
        sessionId: input.sessionId,
        budgetUnits: input.budgetUnits,
        model: input.model,
        riskLevel: input.riskLevel,
        createdAt: now,
        updatedAt: now,
      }),
    );
    this.items.set(item.workItemId, item);
    this.pending.set(item.workItemId, true);
    return this.view(item);
  }

  /**
   * Ask the desk to wake a ticket. A wake that is already queued, or that
   * arrives while the ticket is checked out, collapses into the one pending
   * wake. It does not start a second run.
   */
  wake(workItemId: WorkItemId): WakeResult {
    const item = this.require(workItemId);
    if (TERMINAL.has(item.status)) {
      throw new InvalidStateTransitionError(
        `work item ${workItemId} is ${item.status} and cannot be woken`,
        { workItemId, status: item.status },
      );
    }
    const coalesced = this.pending.has(workItemId);
    this.pending.set(workItemId, true);
    if (item.status !== 'checked_out' && item.status !== 'indeterminate') {
      item.status = 'queued';
    }
    item.updatedAt = this.clock.isoNow();
    return { coalesced };
  }

  /**
   * Drain coalesced wakes. Checkout is taken synchronously, before the
   * orchestrator is awaited, so an overlapping pulse sees the holder and
   * refuses the second claim.
   */
  async pulse(): Promise<HarnessPulseResult> {
    const ids = [...this.pending.keys()];
    const dispatched: WorkItem[] = [];
    const held: WorkItemId[] = [];
    const runnable: WorkItemId[] = [];

    for (const id of ids) {
      const item = this.items.get(id);
      if (!item) {
        this.pending.delete(id);
        continue;
      }
      if (item.status === 'checked_out' || item.status === 'indeterminate') {
        held.push(id);
        continue;
      }
      if (TERMINAL.has(item.status)) {
        this.pending.delete(id);
        continue;
      }
      this.pending.delete(id);
      item.status = 'checked_out';
      item.holder = item.harnessId;
      item.updatedAt = this.clock.isoNow();
      runnable.push(id);
    }

    for (const id of runnable) {
      const item = this.items.get(id);
      if (!item) continue;
      dispatched.push(await this.dispatch(item));
    }
    return { dispatched, held };
  }

  /**
   * Close an indeterminate checkout. `cancel` releases the holder. `retry`
   * queues one wake under the same request id so the harness de-duplicates.
   */
  reconcile(workItemId: WorkItemId, action: ReconcileAction): WorkItem {
    const item = this.require(workItemId);
    if (item.status !== 'indeterminate') {
      throw new InvalidStateTransitionError(
        `work item ${workItemId} is ${item.status}; only an indeterminate checkout can be reconciled`,
        { workItemId, status: item.status, action },
      );
    }
    item.holder = undefined;
    item.updatedAt = this.clock.isoNow();
    if (action === 'cancel') {
      item.status = 'cancelled';
      this.pending.delete(workItemId);
    } else {
      item.status = 'queued';
      this.pending.set(workItemId, true);
    }
    return this.view(item);
  }

  get(workItemId: WorkItemId): WorkItem | undefined {
    const item = this.items.get(workItemId);
    return item ? this.view(item) : undefined;
  }

  private async dispatch(item: WorkItem): Promise<WorkItem> {
    if (!item.requestId) item.requestId = newRequestId();
    try {
      const outcome = await this.deps.orchestrator.submit(commandFor(item));
      return this.settle(item, outcome);
    } catch (err) {
      item.status = 'failed';
      item.holder = undefined;
      item.updatedAt = this.clock.isoNow();
      item.lastError = {
        code: 'VALIDATION',
        message: err instanceof Error ? err.message : 'dispatch failed',
        retryable: false,
      };
      this.pending.delete(item.workItemId);
      return this.view(item);
    }
  }

  private settle(item: WorkItem, outcome: OrchestrationResult): WorkItem {
    item.updatedAt = this.clock.isoNow();
    item.runId = outcome.run.runId;
    item.requestId = outcome.run.requestId as RequestId;
    const sessionId = outcome.result?.metadata['sessionId'];
    if (typeof sessionId === 'string' && sessionId.length > 0) {
      item.sessionId = sessionId;
    }

    if (outcome.status === 'denied') {
      item.status = 'failed';
      item.holder = undefined;
      item.lastError = {
        code: 'POLICY_DENIED',
        message: 'policy denied the command before any harness ran',
        retryable: false,
      };
      this.pending.delete(item.workItemId);
      return this.view(item);
    }

    if (outcome.status === 'awaiting_approval') {
      item.status = 'checked_out';
      item.holder = item.harnessId;
      if (outcome.approval) item.approvalId = outcome.approval.approvalId;
      return this.view(item);
    }

    const indeterminate = outcome.result?.metadata['indeterminate'] === true;
    if (indeterminate) {
      item.status = 'indeterminate';
      item.holder = item.harnessId;
      item.lastError = outcome.result?.error
        ? {
            code: outcome.result.error.code,
            message: outcome.result.error.message,
            retryable: outcome.result.error.retryable,
          }
        : {
            code: 'HARNESS_INDETERMINATE',
            message: 'harness outcome unknown; reconcile before retry',
            retryable: true,
          };
      return this.view(item);
    }

    if (outcome.status === 'completed' && outcome.result?.status === 'succeeded') {
      item.status = 'completed';
      item.holder = undefined;
      item.lastError = undefined;
      this.pending.delete(item.workItemId);
      return this.view(item);
    }

    const cancelled = outcome.result?.metadata['cancelled'] === true;
    item.status = cancelled ? 'cancelled' : 'failed';
    item.holder = undefined;
    if (outcome.result?.error) {
      item.lastError = {
        code: outcome.result.error.code,
        message: outcome.result.error.message,
        retryable: outcome.result.error.retryable,
      };
    }
    this.pending.delete(item.workItemId);
    return this.view(item);
  }

  private require(workItemId: WorkItemId): WorkItem {
    const item = this.items.get(workItemId);
    if (!item) {
      throw new NotFoundError(`work item "${workItemId}" not found`, { workItemId });
    }
    return item;
  }

  /** A copy. Callers cannot mutate desk state through a returned ticket. */
  private view(item: WorkItem): WorkItem {
    return WorkItem.parse(defined({ ...item }));
  }
}

function commandFor(item: WorkItem): CommandInput {
  return {
    name: item.commandName,
    actor: item.actor,
    capability: item.capability,
    requestId: item.requestId,
    ...(item.missionId ? { missionId: item.missionId } : {}),
    // The handoff is the whole payload. No transcript field exists.
    payload: { handoff: item.handoff },
    ...(item.riskLevel ? { riskLevel: item.riskLevel } : {}),
    metadata: defined({
      harnessId: item.harnessId,
      sessionId: item.sessionId,
      budgetUnits: item.budgetUnits,
      model: item.model,
    }),
  };
}

function parseHandoff(value: AgentHandoff): AgentHandoff {
  const parsed = AgentHandoffSchema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('work item message must be an AgentHandoff', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Drop undefined so zod optional fields stay absent. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
