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
 * assertions), unless the harness id is unknown or configured to fail, so tests
 * can exercise both the success and the fail-closed paths.
 */
export interface InMemoryHarnessConfig {
  /** Harnesses this provider advertises and can run. */
  harnesses?: HarnessDescriptor[];
  /** Harness ids that should return a failed result (to test fail-closed). */
  failFor?: HarnessId[];
  /** Fixed usage returned on success. */
  usageUnits?: number;
}

export class InMemoryHarnessProvider implements HarnessExecutionProvider {
  private readonly harnesses: HarnessDescriptor[];
  private readonly failFor: Set<HarnessId>;
  private readonly usageUnits: number;
  /** Every run request seen, in order — for test assertions. */
  readonly calls: HarnessRunRequest[] = [];
  /** Cancellation refs seen, in order. */
  readonly cancellations: { sessionId?: string; runId?: string }[] = [];
  private seq = 0;

  constructor(config: InMemoryHarnessConfig = {}) {
    this.harnesses = config.harnesses ?? [
      { id: 'echo', kind: 'in-memory', capabilities: [] },
    ];
    this.failFor = new Set(config.failFor ?? []);
    this.usageUnits = config.usageUnits ?? 1;
  }

  listHarnesses(): HarnessDescriptor[] {
    return [...this.harnesses];
  }

  supports(harnessId: HarnessId): boolean {
    return this.harnesses.some((h) => h.id === harnessId);
  }

  async run(request: HarnessRunRequest): Promise<HarnessRunResult> {
    this.calls.push(request);
    this.seq += 1;
    const sessionId = request.sessionId ?? `sess_mem_${this.seq}`;

    if (!this.supports(request.harnessId)) {
      return {
        status: 'failed',
        harnessId: request.harnessId,
        error: {
          code: 'HARNESS_NOT_FOUND',
          message: `no harness "${request.harnessId}"`,
          retryable: false,
        },
      };
    }
    if (this.failFor.has(request.harnessId)) {
      return {
        status: 'failed',
        harnessId: request.harnessId,
        ...(request.model !== undefined ? { model: request.model } : {}),
        sessionId,
        error: { code: 'HARNESS_ERROR', message: 'configured failure', retryable: true },
      };
    }

    return {
      status: 'succeeded',
      harnessId: request.harnessId,
      ...(request.model !== undefined ? { model: request.model } : {}),
      sessionId,
      output: { echoed: request.input },
      transcriptRef: `transcript:${sessionId}`,
      usage: { units: this.usageUnits, latencyMs: 0 },
    };
  }

  async cancel(ref: { sessionId?: string; runId?: string }): Promise<void> {
    this.cancellations.push(ref);
  }
}
