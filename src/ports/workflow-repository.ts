import type { Workflow } from '../contracts/workflow.js';
import type { WorkflowId } from '../contracts/identifiers.js';

/**
 * WorkflowRepository port.
 *
 * Workflows are reusable multi-step definitions. Core declares the port;
 * durable implementations live in aion-data. Phase 1 ships an in-memory adapter.
 */
export interface WorkflowRepository {
  get(id: WorkflowId): Promise<Workflow | undefined>;
  save(workflow: Workflow): Promise<void>;
  list(): Promise<Workflow[]>;
}
