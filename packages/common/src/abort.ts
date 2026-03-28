/**
 * Abort Signal Utilities
 *
 * Shared helpers for working with AbortSignal across Takos services.
 */

import { AppError } from './errors.js';

/**
 * Throws an `AppError` if the given signal has been aborted.
 *
 * @param signal  - The abort signal to check (no-op if `undefined`).
 * @param context - A short label describing the call-site, appended to the
 *                  error message for easier debugging (e.g. `'langgraph-start'`).
 */
export function throwIfAborted(signal: AbortSignal | undefined, context?: string): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  const message =
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Run aborted';

  throw new AppError(context ? `${message} (${context})` : message);
}
