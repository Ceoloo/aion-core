import type {
  HarnessDescriptor,
  HarnessExecutionProvider,
  HarnessId,
  HarnessRunRequest,
  HarnessRunResult,
} from '../ports/harness-execution-provider.js';

/**
 * Deterministic, dependency-free {@link HarnessExecutionProvider}. Usable now
 * for tests, examples, and local wiring with no real harness or network — the
 * analog of {@link StaticFeatureGate}. A UHP/HarnessRouter-backed provider
 * implements the same port and is injected at the composition root (ADR-011).
 *
 * `run` echoes the request into a succeeded result (recording every call for
 * assertions), unless the harness id is unknown, the session cannot be resumed,
 * the run would exceed `budgetUnits`, or the harness is configured to fail.
 * A repeated `idempotencyKey` returns the first result and does not run again.
 */
export interface InMemoryHarnessConfig {
  /** Harnesses this provider advertises and can run. */
  harnesses?: HarnessDescriptor[];
  /** Harness ids that should return a failed result (to test fail-closed). */
  failFor?: HarnessId[];
  /** Harness ids that should return an indeterminate result (lost outcome). */
  indeterminateFor?: HarnessId[];
  /** Fixed usage returned on success. */
  usageUnits?: number;
}

export class InMemoryHarnessProvider implements HarnessExecutionProvider {
  private readonly harnesses: HarnessDescriptor[];
  private readonly failFor: Set<HarnessId>;
  private readonly indeterminateFor: Set<HarnessId>;
  private readonly usageUnits: number;
  /** Every run request that was not an idempotent replay, in order. */
  readonly calls: HarnessRunRequest[] = [];
  /** Cancellation refs seen, in order. */
  readonly cancellations: { sessionId?: string; runId?: string }[] = [];
  private seq = 0;
  /** Sessions this provider has actually started. Resume requires membership. */
  private readonly sessions = new Set<string>();
  /** Succeeded or reserved spend per session, in abstract units. */
  private readonly spent = new Map<string, number>();
  /** Prior results keyed by idempotency key. A replay returns the same result. */
  private readonly results = new Map<string, HarnessRunResult>();

  constructor(config: InMemoryHarnessConfig = {}) {
    this.harnesses = config.harnesses ?? [
      { id: 'echo', kind: 'in-memory', capabilities: [] },
    ];
    this.failFor = new Set(config.failFor ?? []);
    this.indeterminateFor = new Set(config.indeterminateFor ?? []);
    this.usageUnits = config.usageUnits ?? 1;
  }

  listHarnesses(): HarnessDescriptor[] {
    return [...this.harnesses];
  }

  supports(harnessId: HarnessId): boolean {
    return this.harnesses.some((h) => h.id === harnessId);
  }

  async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
    if (request.idempotencyKey) {
      const cached = this.results.get(request.idempotencyKey);
      if (cached) return cached;
    }

    this.calls.push(request);

    if (!this.supports(request.harnessId)) {
      return this.remember(request, {
        status: 'failed',
        harnessId: request.harnessId,
        error: {
          code: 'HARNESS_NOT_FOUND',
          message: `no harness "${request.harnessId}"`,
          retryable: false,
        },
      });
    }

    if (request.sessionId !== undefined && !this.sessions.has(request.sessionId)) {
      return this.remember(request, {
        status: 'failed',
        harnessId: request.harnessId,
        ...(request.model !== undefined ? { model: request.model } : {}),
        error: {
          code: 'SESSION_NOT_FOUND',
          message: `no session "${request.sessionId}" to resume`,
          retryable: false,
        },
      });
    }

    const spent = this.spent.get(request.sessionId ?? '') ?? 0;
    if (
      request.budgetUnits !== undefined &&
      spent + this.usageUnits > request.budgetUnits
    ) {
      return this.remember(request, {
        status: 'failed',
        harnessId: request.harnessId,
        ...(request.model !== undefined ? { model: request.model } : {}),
        ...(request.sessionId !== undefined ? { sessionId: request.sessionId } : {}),
        error: {
          code: 'BUDGET_EXCEEDED',
          message: `session spend ${spent} + ${this.usageUnits} exceeds budget ${request.budgetUnits}`,
          retryable: false,
        },
        usage: { units: 0 },
      });
    }

    this.seq += 1;
    const sessionId = request.sessionId ?? `sess_mem_${this.seq}`;
    this.sessions.add(sessionId);
    const base = {
      harnessId: request.harnessId,
      ...(request.model !== undefined ? { model: request.model } : {}),
      sessionId,
    };

    if (this.failFor.has(request.harnessId)) {
      return this.remember(request, {
        ...base,
        status: 'failed',
        error: { code: 'HARNESS_ERROR', message: 'configured failure', retryable: true },
      });
    }
    if (this.indeterminateFor.has(request.harnessId)) {
      this.spent.set(sessionId, spent + this.usageUnits);
      return this.remember(request, {
        ...base,
        status: 'indeterminate',
        error: {
          code: 'HARNESS_TRANSPORT_LOST',
          message: 'response lost',
          retryable: true,
        },
      });
    }

    this.spent.set(sessionId, spent + this.usageUnits);
    return this.remember(request, {
      ...base,
      status: 'succeeded',
      output: { echoed: request.input },
      transcriptRef: `transcript:${sessionId}`,
      usage: { units: this.usageUnits, latencyMs: 0 },
    });
  }

  private remember(request: HarnessRunRequest, result: HarnessRunResult): HarnessRunResult {
    if (request.idempotencyKey) this.results.set(request.idempotencyKey, result);
    return result;
  }

  async cancel(ref: { sessionId?: string; runId?: string }): Promise<void> {
    this.cancellations.push(ref);
  }
}
