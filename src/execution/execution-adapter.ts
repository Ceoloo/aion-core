import type { Command } from '../contracts/command.js';
import type { ExecutionResult } from '../contracts/result.js';
import type { RiskLevel } from '../contracts/risk.js';
import type { Capability } from '../contracts/capability.js';
import type { RunId, RequestId } from '../contracts/identifiers.js';

/**
 * The common execution contract (aion-docs/architecture/execution-layer.md).
 *
 * Every execution environment — native agent, external runtime (Claude Code,
 * Cursor, Codex, Grok, Kimi/OpenClaw), API tool, deterministic service, or a
 * human operator — is invoked through this one contract, so the control plane
 * never special-cases a runtime. Core must remain vendor-agnostic: it never
 * learns which AI vendor sits behind an adapter.
 *
 * Phase 1 ships only a MockExecutionAdapter; the real runtimes are out of scope.
 */

/**
 * The well-formed unit of work handed to an adapter. Mirrors the doc's input
 * contract: goal, context reference, allowed tools/data, constraints, risk
 * level, success criteria — carried by reference, minimized.
 */
export interface ExecutionRequest {
  runId: RunId;
  requestId: RequestId;
  /** The capability the work requires; used for adapter resolution. */
  capability: Capability;
  /** The originating command (intent + payload). */
  command: Command;
  /** Centrally classified risk for this unit of work. */
  riskLevel: RiskLevel;
  /** A pointer to assembled context — not a data dump. */
  contextReference?: string;
  /** Success criteria the evaluator will check against (later phases). */
  successCriteria?: string[];
}

/**
 * An interchangeable execution runtime.
 *
 *  - `canHandle` declares whether the adapter can perform a request (typically
 *    by capability), enabling capability-based routing.
 *  - `execute` performs the work and returns a normalized {@link ExecutionResult}.
 *    A failure is returned as `status: 'failed'` with a structured error — a
 *    first-class, observable outcome, not a thrown surprise. (The orchestrator
 *    also normalizes any thrown error into a failed result, so an adapter may
 *    throw, but returning is preferred.)
 */
export interface ExecutionAdapter {
  /** Stable identifier of this adapter/execution environment. */
  readonly name: string;
  canHandle(request: ExecutionRequest): boolean;
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
