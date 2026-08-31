import type { ApprovalStore } from '../ports/approval-store.js';
import type {
  ApprovalRequest,
  ApprovalStatus,
} from '../contracts/approval.js';
import type { ApprovalId } from '../contracts/identifiers.js';

/** In-memory {@link ApprovalStore}. Phase 1 default; not durable. */
export class InMemoryApprovalStore implements ApprovalStore {
  private readonly requests = new Map<string, ApprovalRequest>();

  async get(id: ApprovalId): Promise<ApprovalRequest | undefined> {
    return this.requests.get(id);
  }

  async save(request: ApprovalRequest): Promise<void> {
    this.requests.set(request.approvalId, request);
  }

  async list(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    const all = [...this.requests.values()];
    return status ? all.filter((r) => r.status === status) : all;
  }
}
