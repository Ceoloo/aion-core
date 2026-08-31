import type {
  ExecutionAdapter,
  ExecutionRequest,
} from './execution-adapter.js';
import type {
  ExecutionResult,
  ExecutionErrorInfo,
  ExecutionCost,
} from '../contracts/result.js';
import type { Capability } from '../contracts/capability.js';
import type { Clock } from '../observability/clock.js';
import { systemClock } from '../observability/clock.js';

/** How the mock adapter behaves when executing. */
export type MockBehavior = 'succeed' | 'fail' | 'throw';

export interface MockExecutionAdapterOptions {
  name?: string;
  /** Capabilities this adapter handles. Omit to handle everything. */
  capabilities?: Capability[];
  /** Custom routing predicate; overrides `capabilities` when provided. */
  handles?: (request: ExecutionRequest) => boolean;
  /** Default execution behavior. Default: 'succeed'. */
  behavior?: MockBehavior;
  /** Output payload returned on success. */
  output?: Record<string, unknown>;
  /** Structured error returned when behavior is 'fail'. */
  error?: ExecutionErrorInfo;
  /** A vendor-neutral model label to report (kept opaque to Core). */
  model?: string;
  /** Simulated cost/usage. */
  cost?: ExecutionCost;
  /** Overrides the computed duration (ms), useful for deterministic tests. */
  durationMs?: number;
  clock?: Clock;
}

/**
 * MockExecutionAdapter.
 *
 * A deterministic stand-in for a real execution runtime, sufficient for
 * integration testing the full lifecycle. It advertises the capabilities it
 * handles and can be configured to succeed, return a normalized failure, or
 * throw (to prove the orchestrator normalizes thrown errors into a failed
 * result). It emits NO real side effects and calls NO model — it only proves
 * the execution contract (aion-docs Phase 1 scope).
 */
export class MockExecutionAdapter implements ExecutionAdapter {
  readonly name: string;
  private readonly capabilities?: Set<string>;
  private readonly handles?: (request: ExecutionRequest) => boolean;
  private readonly behavior: MockBehavior;
  private readonly output: Record<string, unknown>;
  private readonly error: ExecutionErrorInfo;
  private readonly model?: string;
  private readonly cost: ExecutionCost;
  private readonly durationMs?: number;
  private readonly clock: Clock;

  constructor(options: MockExecutionAdapterOptions = {}) {
    this.name = options.name ?? 'mock-execution-adapter';
    this.capabilities = options.capabilities
      ? new Set(options.capabilities)
      : undefined;
    if (options.handles) this.handles = options.handles;
    this.behavior = options.behavior ?? 'succeed';
    this.output = options.output ?? { message: 'mock execution succeeded' };
    this.error =
      options.error ??
      {
        code: 'MOCK_EXECUTION_FAILED',
        message: 'mock execution failed',
        retryable: false,
      };
    if (options.model) this.model = options.model;
    this.cost = options.cost ?? { units: 0 };
    if (options.durationMs !== undefined) this.durationMs = options.durationMs;
    this.clock = options.clock ?? systemClock;
  }

  canHandle(request: ExecutionRequest): boolean {
    if (this.handles) return this.handles(request);
    if (this.capabilities) return this.capabilities.has(request.capability);
    return true;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const startedAt = this.clock.isoNow();

    if (this.behavior === 'throw') {
      throw new Error(
        `mock adapter "${this.name}" threw for run ${request.runId}`,
      );
    }

    const completedAt = this.clock.isoNow();
    const durationMs =
      this.durationMs ??
      Math.max(
        0,
        new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      );

    const base = {
      executor: this.name,
      ...(this.model ? { model: this.model } : {}),
      startedAt,
      completedAt,
      durationMs,
      cost: this.cost,
      metadata: { adapter: this.name },
    };

    if (this.behavior === 'fail') {
      return { status: 'failed', error: this.error, ...base };
    }
    return { status: 'succeeded', output: this.output, ...base };
  }
}
