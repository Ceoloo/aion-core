import type { RunRepository } from '../ports/run-repository.js';
import type { Run } from '../contracts/run.js';
import type { RunId, RequestId } from '../contracts/identifiers.js';

/** In-memory {@link RunRepository}. Phase 1 default; not durable. */
export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, Run>();

  async get(id: RunId): Promise<Run | undefined> {
    return this.runs.get(id);
  }

  async getByRequestId(requestId: RequestId | string): Promise<Run | undefined> {
    let oldest: Run | undefined;
    for (const run of this.runs.values()) {
      if (run.requestId !== requestId) continue;
      if (!oldest || run.createdAt < oldest.createdAt) oldest = run;
    }
    return oldest;
  }

  async save(run: Run): Promise<void> {
    this.runs.set(run.runId, run);
  }

  async list(): Promise<Run[]> {
    return [...this.runs.values()];
  }
}
