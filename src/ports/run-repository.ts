import type { Run } from '../contracts/run.js';
import type { RunId, RequestId } from '../contracts/identifiers.js';

/**
 * RunRepository port.
 *
 * Stores the state of in-flight and completed runs. The orchestrator reads and
 * writes runs through this port so that pausing for a human gate and later
 * resuming the SAME run works against any backing store. Phase 1 uses an
 * in-memory adapter; a durable implementation is supplied externally.
 */
export interface RunRepository {
  get(id: RunId): Promise<Run | undefined>;
  /**
   * Lookup by client `requestId` for submit idempotency. Returns the first
   * matching run (oldest) when duplicates exist historically.
   */
  getByRequestId(requestId: RequestId | string): Promise<Run | undefined>;
  save(run: Run): Promise<void>;
  /** All runs, primarily for inspection/tests. */
  list(): Promise<Run[]>;
}
