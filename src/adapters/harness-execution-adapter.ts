import type { ExecutionAdapter, ExecutionRequest } from '../execution/execution-adapter.js';
import type { ExecutionResult } from '../contracts/result.js';
import type { Command } from '../contracts/command.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';
import type {
  HarnessExecutionProvider,
  HarnessId,
  HarnessRunRequest,
  HarnessRunResult,
} from '../ports/harness-execution-provider.js';

/**
 * Bridges a {@link HarnessExecutionProvider} to the control plane's
 * {@link ExecutionAdapter} (ADR-011). This is how a harness (Codex, Claude Code,
 * a UHP/HarnessRouter backend) becomes a normal execution target: the
 * Orchestrator authorizes a command through the PolicyEngine, then dispatches it
 * here like any other adapter. The adapter never authorizes — it only executes
 * work that policy already cleared — and it fails **closed**: an unresolved or
 * unsupported harness, or a thrown provider error, becomes a first-class
 * `failed` {@link ExecutionResult}, never a silent success.
 */
export interface HarnessExecutionAdapterOptions {
  /** Adapter name (also the executor prefix). Default "harness". */
  name?: string;
  clock?: Clock;
  /**
   * Resolve which harness a command targets. Default: `metadata.harnessId`, else
   * the command's `toolId`. Override to route by capability, risk, tenant, or an
   * experiment (the ExperimentProvider pattern) — selection is not authority.
   */
  resolveHarnessId?: (request: ExecutionRequest) => HarnessId | undefined;
}

export class HarnessExecutionAdapter implements ExecutionAdapter {
  readonly name: string;
  private readonly clock: Clock;
  private readonly resolveHarnessId: (request: ExecutionRequest) => HarnessId | undefined;

  constructor(
    private readonly provider: HarnessExecutionProvider,
    options: HarnessExecutionAdapterOptions = {},
  ) {
    this.name = options.name ?? 'harness';
    this.clock = options.clock ?? systemClock;
    this.resolveHarnessId = options.resolveHarnessId ?? defaultResolveHarnessId;
  }

  /** Handle any request we can resolve a harness id for; support is checked in execute. */
  canHandle(request: ExecutionRequest): boolean {
    return this.resolveHarnessId(request) !== undefined;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = this.clock.isoNow();
    const start = Date.now();
    const finish = (result: Omit<ExecutionResult, 'startedAt' | 'completedAt' | 'durationMs'>): ExecutionResult => ({
      ...result,
      startedAt,
      completedAt: this.clock.isoNow(),
      durationMs: Math.max(0, Date.now() - start),
    });

    const harnessId = this.resolveHarnessId(request);
    if (!harnessId) {
      return finish({
        status: 'failed',
        executor: this.name,
        error: {
          code: 'HARNESS_UNRESOLVED',
          message: 'no harnessId on the command (metadata.harnessId or toolId)',
          retryable: false,
        },
        cost: { units: 0 },
        metadata: {},
      });
    }

    const model = stringMeta(request.command, 'model');
    const budgetUnits = numberMeta(request.command, 'budgetUnits');
    const runRequest: HarnessRunRequest = {
      harnessId,
      input: harnessInput(request.command),
      riskLevel: request.riskLevel,
      runId: request.runId,
      requestId: request.requestId,
      ...(request.contextReference !== undefined
        ? { contextReference: request.contextReference }
        : {}),
      ...(model !== undefined ? { model } : {}),
      ...(budgetUnits !== undefined ? { budgetUnits } : {}),
    };

    let run: HarnessRunResult;
    try {
      run = await this.provider.run(runRequest);
    } catch (err) {
      // Fail closed: a thrown provider error is a visible failed execution.
      return finish({
        status: 'failed',
        executor: `${this.name}:${harnessId}`,
        error: {
          code: 'HARNESS_EXCEPTION',
          message: err instanceof Error ? err.message : 'harness provider threw',
          retryable: true,
        },
        cost: { units: 0 },
        metadata: { harnessId },
      });
    }

    const metadata: Record<string, unknown> = { harnessId: run.harnessId };
    if (run.sessionId !== undefined) metadata.sessionId = run.sessionId;
    if (run.transcriptRef !== undefined) metadata.transcriptRef = run.transcriptRef;
    if (run.status === 'cancelled') metadata.cancelled = true;

    const cost = { units: run.usage?.units ?? 0, ...(run.usage?.tokens !== undefined ? { tokens: run.usage.tokens } : {}) };

    if (run.status === 'succeeded') {
      return finish({
        status: 'succeeded',
        executor: `${this.name}:${run.harnessId}`,
        ...(run.model !== undefined ? { model: run.model } : {}),
        ...(run.output !== undefined ? { output: run.output } : {}),
        cost,
        metadata,
      });
    }

    return finish({
      status: 'failed',
      executor: `${this.name}:${run.harnessId}`,
      ...(run.model !== undefined ? { model: run.model } : {}),
      error: {
        code: run.error?.code ?? (run.status === 'cancelled' ? 'HARNESS_CANCELLED' : 'HARNESS_FAILED'),
        message: run.error?.message ?? run.status,
        retryable: run.error?.retryable ?? false,
      },
      cost,
      metadata,
    });
  }
}

/** metadata.harnessId (a string), else the command's toolId. */
function defaultResolveHarnessId(request: ExecutionRequest): HarnessId | undefined {
  const fromMeta = request.command.metadata['harnessId'];
  if (typeof fromMeta === 'string' && fromMeta.length > 0) return fromMeta;
  return request.command.toolId;
}

/** The goal handed to the harness: an explicit `payload.goal`, else the command name. */
function harnessInput(command: Command): string {
  const goal = command.payload['goal'];
  return typeof goal === 'string' && goal.length > 0 ? goal : command.name;
}

/** A non-empty string metadata field, else undefined. */
function stringMeta(command: Command, key: string): string | undefined {
  const value = command.metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** A finite numeric metadata field, else undefined. */
function numberMeta(command: Command, key: string): number | undefined {
  const value = command.metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
