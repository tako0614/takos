/**
 * Abort Signal Utilities
 *
 * Shared helpers for working with AbortSignal across Takos services.
 */
/**
 * Throws an `AppError` if the given signal has been aborted.
 *
 * @param signal  - The abort signal to check (no-op if `undefined`).
 * @param context - A short label describing the call-site, appended to the
 *                  error message for easier debugging (e.g. `'langgraph-start'`).
 */
export declare function throwIfAborted(signal: AbortSignal | undefined, context?: string): void;
//# sourceMappingURL=abort.d.ts.map