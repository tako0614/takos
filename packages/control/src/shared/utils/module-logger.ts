/**
 * Module Logger -- Consistent logging with module context.
 *
 * Creates loggers bound to a specific module name, ensuring
 * consistent `module` field formatting across the codebase.
 *
 * Many files manually thread `{ module: 'tools/builtin/file/handlers/write' }`
 * into every `logInfo` / `logWarn` / `logError` call.  A module logger
 * binds the module name once and exposes the same three-method interface.
 *
 * This is a lightweight alternative to the existing `createLogger` from
 * `logger.ts` (which accepts a full `LogContext` base).  `createModuleLogger`
 * is purpose-built for the most common pattern: a single `module` tag.
 *
 * @example
 * ```ts
 * import { createModuleLogger } from '../../shared/utils/module-logger';
 *
 * const log = createModuleLogger('tools/builtin/file/handlers/write');
 *
 * log.info('File written', { path, size });
 * log.warn('R2 backup failed', { detail: reason });
 * log.error('Runtime write failed', err);
 * ```
 */

import { logError, logInfo, logWarn } from './logger';

/**
 * A logger bound to a specific module name.
 *
 * Mirrors the `logInfo` / `logWarn` / `logError` signatures from
 * `shared/utils/logger` but automatically injects `{ module }` into
 * every log entry.
 */
export interface ModuleLogger {
  /** Log an informational message. */
  info(message: string, extra?: Record<string, unknown>): void;
  /** Log a warning. */
  warn(message: string, extra?: Record<string, unknown>): void;
  /**
   * Log an error.
   *
   * @param message - human-readable description.
   * @param detail  - the caught error or any additional detail value.
   *                  Passed as the second argument to `logError`
   *                  (accepts `Error | unknown`).
   * @param extra   - optional additional context fields.
   */
  error(message: string, detail?: unknown, extra?: Record<string, unknown>): void;
}

/**
 * Create a {@link ModuleLogger} bound to the given module name.
 *
 * The `module` field is merged into every log entry's context, matching
 * the convention already used throughout the codebase (e.g.
 * `{ module: 'middleware/auth' }`, `{ module: 'tools/builtin/file/handlers/write' }`).
 *
 * @param module - module identifier string (e.g. `"middleware/auth"`).
 * @returns a {@link ModuleLogger} instance.
 */
export function createModuleLogger(module: string): ModuleLogger {
  return {
    info: (message, extra) => logInfo(message, { module, ...extra }),
    warn: (message, extra) => logWarn(message, { module, ...extra }),
    error: (message, detail, extra) => logError(message, detail, { module, ...extra }),
  };
}
