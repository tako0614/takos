// ---------------------------------------------------------------------------
// Shared typed errors for the takos-runtime module.
// Use these instead of plain Error + string matching so that route-level
// classification can rely on `instanceof` checks.
// ---------------------------------------------------------------------------

/**
 * Thrown when a symlink escape is detected during realpath verification.
 * The resolved path points outside the allowed workspace/base directory.
 */
export class SymlinkEscapeError extends Error {
  constructor(label: string) {
    super(`Symlink escape detected in ${label} path`);
    this.name = 'SymlinkEscapeError';
  }
}

/**
 * Thrown when a path component is found to be a symlink where symlinks
 * are not allowed (e.g. workspace directory traversal).
 */
export class SymlinkNotAllowedError extends Error {
  constructor(label?: string) {
    super(label ? `Symlinks are not allowed in ${label} path` : 'Symlinks are not allowed');
    this.name = 'SymlinkNotAllowedError';
  }
}

/**
 * Thrown when a write operation targets a symlink.
 */
export class SymlinkWriteError extends Error {
  constructor() {
    super('Cannot write to symlinks');
    this.name = 'SymlinkWriteError';
  }
}

/**
 * Union type covering all workspace boundary violation errors.
 * Useful for type-narrowing in `instanceof` checks.
 */
export type BoundaryViolationError = SymlinkEscapeError | SymlinkNotAllowedError | SymlinkWriteError;

/**
 * Returns true when `err` is any of the workspace boundary violation error types.
 */
export function isBoundaryViolationError(err: unknown): err is BoundaryViolationError {
  return (
    err instanceof SymlinkEscapeError ||
    err instanceof SymlinkNotAllowedError ||
    err instanceof SymlinkWriteError
  );
}

/**
 * Thrown when a session operation is attempted by a user (owner) who does
 * not match the session's bound owner.
 */
export class OwnerBindingError extends Error {
  constructor(message?: string) {
    super(message ?? 'Session does not belong to the authenticated owner');
    this.name = 'OwnerBindingError';
  }
}
