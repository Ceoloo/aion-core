import type {
  ApprovalRequest,
  ApprovalStatus,
} from '../contracts/approval.js';
import type { ApprovalId } from '../contracts/identifiers.js';

/**
 * ApprovalStore port.
 *
 * Persists human-gate requests and their decisions. Because the store holds the
 * proposed command, a paused run can be resumed deterministically after a human
 * decides. Phase 1 uses an in-memory store; no UI, Slack, email, or external
 * notification infrastructure is built — only the contract is proven.
 */
export interface ApprovalStore {
  get(id: ApprovalId): Promise<ApprovalRequest | undefined>;
  save(request: ApprovalRequest): Promise<void>;
  /** List requests, optionally filtered by status (e.g. pending). */
  list(status?: ApprovalStatus): Promise<ApprovalRequest[]>;
}
