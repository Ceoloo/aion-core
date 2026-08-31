/**
 * Domain errors.
 *
 * Errors crossing module boundaries are machine-readable (a stable `code` and
 * structured `details`), not opaque strings (aion-docs/engineering/
 * api-standards.md: "Errors are structured and honest"). Every AION Core error
 * extends {@link AionError}, so a consumer can branch on `code` without string
 * matching.
 */

export const ERROR_CODES = [
  'VALIDATION',
  'PERMISSION_DENIED',
  'APPROVAL_REQUIRED',
  'INVALID_STATE_TRANSITION',
  'EXECUTOR_NOT_FOUND',
  'EXECUTION',
  'NOT_FOUND',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Base class for all AION Core domain errors. */
export abstract class AionError extends Error {
  abstract readonly code: ErrorCode;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
    // Restore prototype chain for instanceof across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Machine-readable projection, safe to log or serialize. */
  toJSON(): { name: string; code: ErrorCode; message: string; details: Record<string, unknown> } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

/** A boundary input failed validation against its contract. */
export class ValidationError extends AionError {
  readonly code = 'VALIDATION';
}

/** The actor is not permitted to perform the requested capability/tool. */
export class PermissionDeniedError extends AionError {
  readonly code = 'PERMISSION_DENIED';
}

/**
 * The action requires a human gate that has not been cleared. Thrown when code
 * attempts to execute a run that is awaiting approval.
 */
export class ApprovalRequiredError extends AionError {
  readonly code = 'APPROVAL_REQUIRED';
}

/** An attempt was made to move a run through an illegal state transition. */
export class InvalidStateTransitionError extends AionError {
  readonly code = 'INVALID_STATE_TRANSITION';
}

/** No registered execution adapter can handle the required capability. */
export class ExecutorNotFoundError extends AionError {
  readonly code = 'EXECUTOR_NOT_FOUND';
}

/** An execution adapter failed while performing the work. */
export class ExecutionError extends AionError {
  readonly code = 'EXECUTION';
}

/** A referenced entity (run, approval, mission) does not exist. */
export class NotFoundError extends AionError {
  readonly code = 'NOT_FOUND';
}

/** Type guard for AION Core domain errors. */
export function isAionError(value: unknown): value is AionError {
  return value instanceof AionError;
}
