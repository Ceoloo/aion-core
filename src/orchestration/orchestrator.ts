import { Command, type CommandInput } from '../contracts/command.js';
import type { Run } from '../contracts/run.js';
import type { PolicyDecision } from '../contracts/policy.js';
import type { ApprovalRequest, ApprovalDecision } from '../contracts/approval.js';
import type { ExecutionResult } from '../contracts/result.js';
import { ExecutionResult as ExecutionResultSchema } from '../contracts/result.js';
import type { OutcomeReference } from '../contracts/outcome.js';
import type { ApprovalState } from '../contracts/telemetry.js';
import type { EventId } from '../contracts/identifiers.js';
import { newCommandId, newRequestId } from '../contracts/identifiers.js';
import { ValidationError, NotFoundError, isAionError } from '../errors/index.js';

import type { PolicyEngine } from '../policy/policy-engine.js';
import type { ExecutionRegistry } from '../execution/execution-registry.js';
import type { ExecutionRequest } from '../execution/execution-adapter.js';
import type { ApprovalGate } from '../approvals/approval-gate.js';
import type { RunRepository } from '../ports/run-repository.js';
import type { EventEmitter } from '../events/event-emitter.js';
import type { Telemetry } from '../observability/telemetry.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';

import {
  createRunContext,
  restoreRunContext,
  type RunContext,
} from './run-context.js';
import { transitionRun } from './lifecycle.js';

/** The dependencies the orchestration kernel coordinates. */
export interface OrchestratorDeps {
  policyEngine: PolicyEngine;
  registry: ExecutionRegistry;
  approvalGate: ApprovalGate;
  runRepository: RunRepository;
  events: EventEmitter;
  telemetry: Telemetry;
  clock?: Clock;
}

/**
 * The result of processing (or resuming) a command. A flat, inspectable record
 * whose populated fields depend on `status`:
 *
 *  - `completed` / `failed`  → `result` + `outcomeReference` are present.
 *  - `denied`                → policy or gate rejected; no `result`.
 *  - `awaiting_approval`     → `approval` is present; the run is paused.
 */
export interface OrchestrationResult {
  status: 'completed' | 'failed' | 'denied' | 'awaiting_approval';
  run: Run;
  command: Command;
  decision: PolicyDecision;
  result?: ExecutionResult;
  approval?: ApprovalRequest;
  outcomeReference?: OutcomeReference;
}

/**
 * Orchestrator — the control-plane kernel.
 *
 * It *decides and coordinates*; it never performs the work itself
 * (aion-docs/architecture/control-plane.md: "The orchestrator never executes").
 * For each command it: mints a trace/run context, validates, emits
 * `command.received`, evaluates policy, and then routes to denial, a human
 * gate, or execution — emitting facts and telemetry at every step so the whole
 * lifecycle is traceable and deterministic.
 *
 * Denied actions never reach an execution adapter. High-risk actions pause at a
 * gate and resume the SAME run on approval.
 */
export class Orchestrator {
  private readonly clock: Clock;

  constructor(private readonly deps: OrchestratorDeps) {
    this.clock = deps.clock ?? systemClock;
  }

  /** Process a new command through the full lifecycle. */
  async submit(input: CommandInput): Promise<OrchestrationResult> {
    const command = this.normalizeCommand(input);
    const ctx = createRunContext(command, this.clock);

    // Persist the created run, then record receipt of the command as a fact.
    await this.saveRun(ctx.run);
    const received = await this.deps.events.emit({
      type: 'command.received',
      trace: ctx.trace,
      payload: { name: command.name, capability: command.capability },
    });
    await this.deps.telemetry.record({
      operation: 'command.received',
      status: 'ok',
      trace: ctx.trace,
    });

    // Move into evaluation and run the policy engine.
    ctx.run = await this.saveRun(
      transitionRun(ctx.run, 'evaluating', this.clock),
    );
    const decision = this.deps.policyEngine.evaluate(command);
    ctx.run = { ...ctx.run, riskLevel: decision.riskLevel };
    await this.saveRun(ctx.run);

    if (decision.decision === 'DENY') {
      return this.finishDenied(ctx, decision, received.eventId);
    }

    if (decision.decision === 'REQUIRE_APPROVAL') {
      return this.pauseForApproval(ctx, decision, received.eventId);
    }

    // ALLOW — record the allowance as a fact, then execute.
    const allowed = await this.deps.events.emit({
      type: 'policy.allowed',
      trace: ctx.trace,
      causationId: received.eventId,
      payload: { policyId: decision.policyId, riskLevel: decision.riskLevel },
    });
    await this.deps.telemetry.record({
      operation: 'policy.evaluate',
      status: 'ok',
      trace: ctx.trace,
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      approvalState: 'not_required',
    });
    return this.execute(ctx, decision, 'not_required', allowed.eventId);
  }

  /**
   * Resume a paused run after a human decision. Approval resumes the ORIGINAL
   * run — no second, unrelated execution is created.
   */
  async resume(decision: ApprovalDecision): Promise<OrchestrationResult> {
    const approval = await this.deps.approvalGate.decide(decision);
    const run = await this.deps.runRepository.get(approval.runId);
    if (!run) {
      throw new NotFoundError(`run "${approval.runId}" not found for approval`, {
        runId: approval.runId,
        approvalId: approval.approvalId,
      });
    }

    const ctx = restoreRunContext(run, approval.command);
    // Re-evaluate to reconstruct the (deterministic) policy decision.
    const policyDecision = this.deps.policyEngine.evaluate(approval.command);

    if (!decision.approve) {
      const rejected = await this.deps.events.emit({
        type: 'approval.rejected',
        trace: ctx.trace,
        payload: { approvalId: approval.approvalId, decidedBy: decision.decidedBy },
      });
      ctx.run = await this.saveRun(
        transitionRun(ctx.run, 'denied', this.clock),
      );
      await this.deps.telemetry.record({
        operation: 'approval.decide',
        status: 'denied',
        trace: ctx.trace,
        riskLevel: approval.riskLevel,
        approvalState: 'rejected',
        metadata: { causationId: rejected.eventId },
      });
      return {
        status: 'denied',
        run: ctx.run,
        command: approval.command,
        decision: policyDecision,
        approval,
      };
    }

    const granted = await this.deps.events.emit({
      type: 'approval.granted',
      trace: ctx.trace,
      payload: { approvalId: approval.approvalId, decidedBy: decision.decidedBy },
    });
    ctx.run = await this.saveRun(
      transitionRun(ctx.run, 'approved', this.clock),
    );
    await this.deps.telemetry.record({
      operation: 'approval.decide',
      status: 'ok',
      trace: ctx.trace,
      riskLevel: approval.riskLevel,
      approvalState: 'approved',
    });
    return this.execute(ctx, policyDecision, 'approved', granted.eventId);
  }

  /** Look up a run by id. */
  async getRun(run: Run['runId']): Promise<Run | undefined> {
    return this.deps.runRepository.get(run);
  }

  // ── internals ──────────────────────────────────────────────────────────

  private normalizeCommand(input: CommandInput): Command {
    const draft = {
      commandId: newCommandId(),
      requestId: input.requestId ?? newRequestId(),
      ...(input.missionId ? { missionId: input.missionId } : {}),
      ...(input.workflowId ? { workflowId: input.workflowId } : {}),
      name: input.name,
      actor: input.actor,
      capability: input.capability,
      ...(input.toolId ? { toolId: input.toolId } : {}),
      payload: input.payload ?? {},
      ...(input.riskLevel ? { riskLevel: input.riskLevel } : {}),
      createdAt: this.clock.isoNow(),
      metadata: input.metadata ?? {},
    };
    const parsed = Command.safeParse(draft);
    if (!parsed.success) {
      throw new ValidationError('invalid command', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  private async pauseForApproval(
    ctx: RunContext,
    decision: PolicyDecision,
    causationId: EventId,
  ): Promise<OrchestrationResult> {
    const approval = await this.deps.approvalGate.request(
      ctx.command,
      ctx.run.runId,
      decision,
    );
    ctx.run = await this.saveRun({
      ...transitionRun(ctx.run, 'awaiting_approval', this.clock),
      approvalId: approval.approvalId,
    });
    await this.deps.events.emit({
      type: 'approval.requested',
      trace: ctx.trace,
      causationId,
      payload: {
        approvalId: approval.approvalId,
        riskLevel: decision.riskLevel,
        reason: decision.reason,
      },
    });
    await this.deps.telemetry.record({
      operation: 'approval.request',
      status: 'pending',
      trace: ctx.trace,
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      approvalState: 'pending',
      approvalId: approval.approvalId,
    });
    return {
      status: 'awaiting_approval',
      run: ctx.run,
      command: ctx.command,
      decision,
      approval,
    };
  }

  private async finishDenied(
    ctx: RunContext,
    decision: PolicyDecision,
    causationId: EventId,
  ): Promise<OrchestrationResult> {
    await this.deps.events.emit({
      type: 'policy.denied',
      trace: ctx.trace,
      causationId,
      payload: { reason: decision.reason, policyId: decision.policyId },
    });
    ctx.run = await this.saveRun(transitionRun(ctx.run, 'denied', this.clock));
    await this.deps.telemetry.record({
      operation: 'policy.evaluate',
      status: 'denied',
      trace: ctx.trace,
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      approvalState: 'not_required',
    });
    return { status: 'denied', run: ctx.run, command: ctx.command, decision };
  }

  /** Route to an adapter and run the work, normalizing every outcome. */
  private async execute(
    ctx: RunContext,
    decision: PolicyDecision,
    approvalState: ApprovalState,
    causationId: EventId,
  ): Promise<OrchestrationResult> {
    const request: ExecutionRequest = {
      runId: ctx.run.runId,
      requestId: ctx.run.requestId,
      capability: ctx.command.capability,
      command: ctx.command,
      riskLevel: decision.riskLevel,
    };

    const adapter = this.deps.registry.resolve(request);
    if (!adapter) {
      // Cleared for execution, but no runtime can perform it: a routing
      // failure, normalized to a failed run and observed like any failure.
      const result = this.failureResult(
        'unrouted',
        'EXECUTOR_NOT_FOUND',
        `no execution adapter can handle capability "${ctx.command.capability}"`,
      );
      return this.finishExecution(
        ctx,
        decision,
        result,
        approvalState,
        causationId,
      );
    }

    ctx.run = await this.saveRun(
      transitionRun(ctx.run, 'executing', this.clock),
    );
    const started = await this.deps.events.emit({
      type: 'execution.started',
      trace: ctx.trace,
      causationId,
      payload: { executor: adapter.name, capability: ctx.command.capability },
    });

    let result: ExecutionResult;
    try {
      const raw = await adapter.execute(request);
      const parsed = ExecutionResultSchema.safeParse(raw);
      result = parsed.success
        ? parsed.data
        : this.failureResult(
            adapter.name,
            'MALFORMED_RESULT',
            'adapter returned a result that failed contract validation',
          );
    } catch (err) {
      result = this.failureResult(
        adapter.name,
        'EXECUTION',
        isAionError(err) ? err.message : (err as Error).message,
      );
    }

    return this.finishExecution(
      ctx,
      decision,
      result,
      approvalState,
      started.eventId,
    );
  }

  private async finishExecution(
    ctx: RunContext,
    decision: PolicyDecision,
    result: ExecutionResult,
    approvalState: ApprovalState,
    causationId: EventId,
  ): Promise<OrchestrationResult> {
    const succeeded = result.status === 'succeeded';
    ctx.run = await this.saveRun(
      transitionRun(ctx.run, succeeded ? 'completed' : 'failed', this.clock),
    );
    await this.deps.events.emit({
      type: succeeded ? 'execution.completed' : 'execution.failed',
      trace: ctx.trace,
      causationId,
      payload: {
        status: result.status,
        executor: result.executor,
        ...(result.error ? { error: result.error } : {}),
      },
    });
    await this.deps.telemetry.record({
      operation: 'execution',
      status: succeeded ? 'ok' : 'failed',
      trace: ctx.trace,
      decision: decision.decision,
      riskLevel: decision.riskLevel,
      approvalState,
      executor: result.executor,
      ...(result.model ? { model: result.model } : {}),
      durationMs: result.durationMs,
      cost: result.cost.units,
      ...(result.cost.tokens !== undefined
        ? { tokenUsage: result.cost.tokens }
        : {}),
    });

    const outcomeReference: OutcomeReference = {
      runId: ctx.run.runId,
      ...(ctx.run.missionId ? { missionId: ctx.run.missionId } : {}),
      status: 'pending',
      metadata: {},
    };

    return {
      status: succeeded ? 'completed' : 'failed',
      run: ctx.run,
      command: ctx.command,
      decision,
      result,
      outcomeReference,
    };
  }

  private failureResult(
    executor: string,
    code: string,
    message: string,
  ): ExecutionResult {
    const now = this.clock.isoNow();
    return {
      status: 'failed',
      error: { code, message, retryable: false },
      executor,
      startedAt: now,
      completedAt: now,
      durationMs: 0,
      cost: { units: 0 },
      metadata: {},
    };
  }

  private async saveRun(run: Run): Promise<Run> {
    await this.deps.runRepository.save(run);
    return run;
  }
}
