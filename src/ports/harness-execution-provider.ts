import type { RiskLevel } from '../contracts/risk.js';
import type { RunId, RequestId } from '../contracts/identifiers.js';

/**
 * HarnessExecutionProvider port (ADR-011).
 *
 * A *harness* is an execution environment that runs an agent loop with a real
 * workspace (filesystem, shell, git) — Codex, Claude Code, a custom harness, or
 * anything speaking the Unified Harness Protocol (HarnessRouter/UHP). This port
 * is the vendor-neutral seam for "run this authorized unit of work on harness X
 * with model Y", exactly as {@link FeatureGate} is the seam for flags and
 * `DecisionProvider` is the seam for decisions. Core never depends on UHP or any
 * harness SDK; a UHP-backed provider is injected at the composition root.
 *
 * Boundary rules (normative — same trust posture as ADR-008 / ADR-010):
 *  - **Not authority.** A provider never authorizes anything. It is dispatched
 *    to *after* the PolicyEngine has authorized the command and classified its
 *    risk. Harness selection (which `harnessId`) is a routing/optimization
 *    input, never permission.
 *  - **Fails closed at the boundary.** Unlike the FeatureGate (fail-open, an
 *    input), this executes authorized work: a provider error is a first-class
 *    `failed` {@link HarnessRunResult}, surfaced — never silently treated as
 *    success. A dropped execution must be visible.
 *  - **No raw tenant PII crosses the seam.** Context and files are passed by
 *    reference ({@link HarnessRunRequest.contextReference}, `fileRefs`), never
 *    inlined. Secrets are passed as {@link HarnessEnvRef}s (a name + a resolver
 *    reference); the composition root resolves them — Core never holds the
 *    secret value.
 *  - **Least privilege + budget.** `riskLevel` and `budgetUnits` come from the
 *    authorized command; a provider must honor the budget ceiling and run under
 *    the workspace/tool scope the caller grants, nothing wider.
 */

/** Stable identifier of a harness, e.g. "codex", "claude-code", "custom-slides". */
export type HarnessId = string;

/** What a provider can dispatch to — the routing/experiment surface. */
export interface HarnessDescriptor {
  id: HarnessId;
  /** Kind/label: "codex" | "claude-code" | "hermes" | "custom" | … */
  kind: string;
  /** Models this harness may be driven with (empty ⇒ provider default / any). */
  models?: string[];
  /** Capability names this harness can serve (for capability-based routing). */
  capabilities?: string[];
}

/**
 * A non-secret reference to a value the harness should expose to the agent as an
 * environment variable. The composition root resolves `from` (e.g. a vault key
 * or a request header) — the raw secret never enters Core or this request.
 */
export interface HarnessEnvRef {
  /** Env var name the agent's shell/tools see. */
  name: string;
  /** Resolver reference: "vault:<key>" | "$headers.X-…" | a literal marker. */
  from: string;
}

/** One authorized unit of work to run on a harness. */
export interface HarnessRunRequest {
  harnessId: HarnessId;
  /** Vendor-neutral model id, when a model is involved. */
  model?: string;
  /** The goal/instructions for the harness — already policy-authorized. */
  input: string;
  /** Resume a prior session's workspace instead of starting fresh. */
  sessionId?: string;
  /** Pointer to assembled context — not a data dump. */
  contextReference?: string;
  /** Files to stage into the workspace, by reference/URI — never inline PII. */
  fileRefs?: string[];
  /** Non-secret env references; the composition root resolves the values. */
  env?: HarnessEnvRef[];
  /** Centrally classified risk of this unit of work (from the PolicyEngine). */
  riskLevel: RiskLevel;
  /** Abstract budget ceiling (FinOps); the provider must stop at it. */
  budgetUnits?: number;
  /** Trace correlation into the ledger. */
  runId?: RunId;
  requestId?: RequestId;
  /** Request server-sent events when the provider supports streaming. */
  stream?: boolean;
}

export interface HarnessUsage {
  /** Abstract spend units for this run. */
  units: number;
  tokens?: number;
  latencyMs?: number;
}

/** The normalized outcome of a harness run. A failure is first-class. */
export interface HarnessRunResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  harnessId: HarnessId;
  model?: string;
  /** The (possibly newly created) session whose workspace ran the task. */
  sessionId?: string;
  /** Capability-specific output payload. */
  output?: Record<string, unknown>;
  /** Reference to the full transcript in the ledger/store — not inlined. */
  transcriptRef?: string;
  usage?: HarnessUsage;
  error?: { code: string; message: string; retryable?: boolean };
}

/**
 * An interchangeable set of harnesses behind one contract. A concrete
 * implementation (UHP/HarnessRouter, or an in-workspace runner) is injected at
 * the composition root; a {@link HarnessExecutionAdapter} bridges it to the
 * control plane's {@link ExecutionAdapter} so authorized commands dispatch to a
 * harness through the normal Execution Gateway path.
 */
export interface HarnessExecutionProvider {
  /** The harnesses available for routing/experiments. */
  listHarnesses(): HarnessDescriptor[] | Promise<HarnessDescriptor[]>;
  /** Whether this provider can run `harnessId`. */
  supports(harnessId: HarnessId): boolean | Promise<boolean>;
  /**
   * Run one authorized unit of work. Implementations return a `failed`
   * {@link HarnessRunResult} rather than throwing where possible; a thrown error
   * is normalized to a failed execution by the adapter (fail-closed).
   */
  run(request: HarnessRunRequest): Promise<HarnessRunResult>;
  /** Best-effort cancellation of an in-flight run/session. */
  cancel(ref: { sessionId?: string; runId?: string }): Promise<void>;
}
