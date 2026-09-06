import type { WorkflowRepository } from '../ports/workflow-repository.js';
import type { Workflow } from '../contracts/workflow.js';
import type { WorkflowId } from '../contracts/identifiers.js';

/** In-memory {@link WorkflowRepository}. Phase 1 default; not durable. */
export class InMemoryWorkflowRepository implements WorkflowRepository {
  private readonly workflows = new Map<string, Workflow>();

  async get(id: WorkflowId): Promise<Workflow | undefined> {
    return this.workflows.get(id);
  }

  async save(workflow: Workflow): Promise<void> {
    this.workflows.set(workflow.workflowId, workflow);
  }

  async list(): Promise<Workflow[]> {
    return [...this.workflows.values()];
  }
}
