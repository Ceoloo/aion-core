import type {
  ExecutionAdapter,
  ExecutionRequest,
} from './execution-adapter.js';
import { ExecutorNotFoundError } from '../errors/index.js';

/**
 * ExecutionRegistry.
 *
 * A minimal capability-based router: it registers adapters and resolves the
 * first one that can handle a request. It rejects execution when no suitable
 * adapter exists (aion-docs invariant: "Denied actions never reach execution";
 * unroutable work fails fast rather than silently).
 *
 * Deliberately NOT built: scheduling, load balancing, queues, distributed
 * worker management, multi-region routing. Phase 1 proves the abstraction.
 */
export class ExecutionRegistry {
  private readonly adapters: ExecutionAdapter[] = [];

  /** Register an adapter. Registration order is resolution priority. */
  register(adapter: ExecutionAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  /** The first adapter that can handle the request, or undefined. */
  resolve(request: ExecutionRequest): ExecutionAdapter | undefined {
    return this.adapters.find((a) => a.canHandle(request));
  }

  /** Resolve or throw {@link ExecutorNotFoundError}. */
  resolveOrThrow(request: ExecutionRequest): ExecutionAdapter {
    const adapter = this.resolve(request);
    if (!adapter) {
      throw new ExecutorNotFoundError(
        `no execution adapter can handle capability "${request.capability}"`,
        { capability: request.capability, runId: request.runId },
      );
    }
    return adapter;
  }

  /** Names of all registered adapters, in priority order. */
  registeredNames(): string[] {
    return this.adapters.map((a) => a.name);
  }
}
