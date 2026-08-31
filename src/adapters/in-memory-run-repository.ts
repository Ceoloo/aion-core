import type { RunRepository } from '../ports/run-repository.js';
import type { Run } from '../contracts/run.js';
import type { RunId } from '../contracts/identifiers.js';

/** In-memory {@link RunRepository}. Phase 1 default; not durable. */
export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, Run>();

  async get(id: RunId): Promise<Run | undefined> {
    return this.runs.get(id);
  }

  async save(run: Run): Promise<void> {
    this.runs.set(run.runId, run);
  }

  async list(): Promise<Run[]> {
    return [...this.runs.values()];
  }
}
