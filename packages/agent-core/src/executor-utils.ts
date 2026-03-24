/**
 * Shared executor utilities for the OSS container executor and private runners.
 *
 * Extracts common patterns:
 * - parseStartPayload: validates incoming /start request body
 * - createConcurrencyGuard: manages activeRuns counter with capacity check
 * - createGracefulShutdown: wires up SIGTERM/SIGINT handlers with drain logic
 */

import type { StartPayload } from './run-executor.js';

// ---------------------------------------------------------------------------
// Payload parsing
// ---------------------------------------------------------------------------

export type ParseResult<T> = { ok: true; payload: T } | { ok: false; error: string };

/**
 * Validate and extract a StartPayload from an unknown request body.
 * Returns a discriminated union so callers can pattern-match on `ok`.
 */
export function parseStartPayload(value: unknown): ParseResult<StartPayload> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }

  const v = value as Record<string, unknown>;

  if (typeof v.runId !== 'string' || v.runId.length === 0) {
    return { ok: false, error: 'Missing required field: runId' };
  }

  const serviceId = typeof v.serviceId === 'string' && v.serviceId.length > 0
    ? v.serviceId
    : typeof v.workerId === 'string' && v.workerId.length > 0
      ? v.workerId
      : undefined;

  if (!serviceId) {
    return { ok: false, error: 'Missing required field: serviceId or workerId' };
  }

  const controlRpcToken = typeof v.controlRpcToken === 'string' && v.controlRpcToken.length > 0
    ? v.controlRpcToken
    : undefined;

  if (!controlRpcToken) {
    return { ok: false, error: 'Missing required field: controlRpcToken' };
  }

  // Validate optional string fields
  for (const field of ['model', 'controlRpcBaseUrl'] as const) {
    if (v[field] !== undefined && typeof v[field] !== 'string') {
      return { ok: false, error: `${field} must be a string when provided` };
    }
  }

  return {
    ok: true,
    payload: {
      runId: v.runId as string,
      serviceId,
      workerId: typeof v.workerId === 'string' && v.workerId.length > 0 ? v.workerId : serviceId,
      model: v.model as string | undefined,
      controlRpcToken,
      controlRpcBaseUrl: v.controlRpcBaseUrl as string | undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

export interface ConcurrencyGuard {
  /** Current number of active runs. */
  readonly activeRuns: number;
  /** Maximum allowed concurrent runs. */
  readonly maxConcurrentRuns: number;
  /** Number of available slots. */
  readonly available: number;
  /** Returns true if a new run can be accepted (and increments the counter). */
  tryAcquire(): boolean;
  /** Decrements the counter (clamped to 0). */
  release(): void;
}

/**
 * Create a concurrency guard that tracks active runs.
 * Thread-safe in Node.js single-threaded model: synchronous check + increment
 * cannot be interleaved between awaits.
 */
export function createConcurrencyGuard(maxConcurrentRuns: number): ConcurrencyGuard {
  let activeRuns = 0;

  return {
    get activeRuns() {
      return activeRuns;
    },
    get maxConcurrentRuns() {
      return maxConcurrentRuns;
    },
    get available() {
      return maxConcurrentRuns - activeRuns;
    },
    tryAcquire(): boolean {
      if (activeRuns >= maxConcurrentRuns) return false;
      activeRuns++;
      return true;
    },
    release(): void {
      activeRuns = Math.max(0, activeRuns - 1);
    },
  };
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

export interface GracefulShutdownOptions {
  /** Service name for log messages (e.g., 'takos-executor', 'private-runner') */
  serviceName: string;
  /** Logger instance */
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  /** AbortController to signal active runs to stop */
  shutdownController: AbortController;
  /** Concurrency guard to check active runs */
  concurrency: ConcurrencyGuard;
  /** The HTTP server to close */
  server: { close(cb?: () => void): void };
  /** Milliseconds to wait for active runs before force exit (default: 30000) */
  gracePeriodMs?: number;
}

/**
 * Create and install a graceful shutdown handler.
 * Registers SIGTERM and SIGINT handlers that:
 * 1. Abort all active runs via the shutdownController
 * 2. Close the HTTP server
 * 3. Wait for active runs to drain (polling every 500ms)
 * 4. Force exit after gracePeriodMs if runs haven't drained
 *
 * Returns a cleanup function that removes the signal handlers.
 */
export function installGracefulShutdown(options: GracefulShutdownOptions): () => void {
  const {
    serviceName,
    logger,
    shutdownController,
    concurrency,
    server,
    gracePeriodMs = 30_000,
  } = options;

  const tag = serviceName;

  function shutdown(signal: string): void {
    logger.info(`[${tag}] Received ${signal}, shutting down (${concurrency.activeRuns} active runs)`);
    // Signal all active runs to abort
    shutdownController.abort(new Error(`Shutdown: ${signal}`));
    server.close(() => {
      logger.info(`[${tag}] Server closed`);
    });
    // Wait for active runs to drain, then force exit
    const waitForDrain = setInterval(() => {
      if (concurrency.activeRuns <= 0) {
        clearInterval(waitForDrain);
        process.exit(0);
      }
    }, 500);
    waitForDrain.unref();
    setTimeout(() => {
      logger.warn(`[${tag}] Force exit after ${gracePeriodMs}ms (${concurrency.activeRuns} runs still active)`);
      process.exit(1);
    }, gracePeriodMs).unref();
  }

  const onSigterm = () => shutdown('SIGTERM');
  const onSigint = () => shutdown('SIGINT');

  process.once('SIGTERM', onSigterm);
  process.once('SIGINT', onSigint);

  // Return cleanup function
  return () => {
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('SIGINT', onSigint);
  };
}
