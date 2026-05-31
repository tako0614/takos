/**
 * Provider-neutral implementation of the AnalyticsEngine binding.
 *
 * Supports three backends controlled by configuration:
 * - **otel**: Sends data points to an OpenTelemetry collector endpoint
 * - **buffer**: Accumulates data points in-memory (for local dev / debugging)
 * - **noop**: Silently discards data points (default)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnalyticsEngineDataPoint {
  blobs?: string[];
  doubles?: number[];
  indexes?: string[];
}

export interface AnalyticsEngineDataset {
  writeDataPoint(event: AnalyticsEngineDataPoint): void;
}

export type AnalyticsEngineConfig = {
  dataset: string;
  /** OTEL collector endpoint (e.g., http://localhost:4318/v1/logs). */
  otelEndpoint?: string;
  /** Backend mode. Defaults to 'noop'. */
  mode?: "otel" | "buffer" | "noop";
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Disposable variant of the binding. Callers that replace or drop a binding
 * instance should invoke `dispose()` to cancel the pending flush timer and
 * release any queued data points; otherwise the timer fires against a
 * detached closure that still holds onto the pending batch.
 */
export type AnalyticsEngineBinding =
  & AnalyticsEngineDataset
  & {
    getBuffer(): AnalyticsEngineDataPoint[];
    /** Best-effort synchronous flush of any pending OTEL batch. */
    flush(): void;
    /**
     * Cancel the pending flush timer, drain any buffered data points, and
     * mark the binding as disposed. Subsequent `writeDataPoint` calls become
     * no-ops so the instance can be garbage-collected without holding the
     * event loop open.
     */
    dispose(): void;
    /** Whether dispose() has been called. */
    readonly disposed: boolean;
  };

export function createAnalyticsEngineBinding(
  config: AnalyticsEngineConfig,
): AnalyticsEngineBinding {
  const mode = config.mode ?? (config.otelEndpoint ? "otel" : "noop");
  const buffer: AnalyticsEngineDataPoint[] = [];

  // Batched OTEL flush
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingBatch: AnalyticsEngineDataPoint[] = [];
  let disposed = false;

  function clearFlushTimer(): void {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flushToOtel() {
    clearFlushTimer();
    if (pendingBatch.length === 0 || !config.otelEndpoint) return;

    const batch = pendingBatch.splice(0);
    const body = JSON.stringify({
      resourceLogs: [{
        resource: {
          attributes: [{
            key: "service.name",
            value: { stringValue: `takos-analytics:${config.dataset}` },
          }],
        },
        scopeLogs: [{
          scope: { name: config.dataset },
          logRecords: batch.map((dp) => ({
            timeUnixNano: String(Date.now() * 1_000_000),
            body: { stringValue: JSON.stringify(dp) },
            attributes: [
              ...(dp.indexes ?? []).map((idx, i) => ({
                key: `index.${i}`,
                value: { stringValue: idx },
              })),
            ],
          })),
        }],
      }],
    });

    // Fire-and-forget POST to OTEL collector
    fetch(config.otelEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(
      () => {
        /* fire-and-forget: OTEL collector POST failure is non-critical */
      },
    );
  }

  const binding: AnalyticsEngineBinding = {
    writeDataPoint(event: AnalyticsEngineDataPoint): void {
      if (disposed) return;
      switch (mode) {
        case "buffer":
          buffer.push(event);
          break;
        case "otel":
          pendingBatch.push(event);
          // Batch flush: 100 data points or 1 second, whichever comes first
          if (pendingBatch.length >= 100) {
            flushToOtel();
          } else if (!flushTimer) {
            flushTimer = setTimeout(() => {
              flushTimer = null;
              flushToOtel();
            }, 1000);
          }
          break;
        case "noop":
        default:
          break;
      }
    },

    /** Access the in-memory buffer (only useful in 'buffer' mode). */
    getBuffer(): AnalyticsEngineDataPoint[] {
      return buffer;
    },

    flush(): void {
      if (disposed) return;
      flushToOtel();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearFlushTimer();
      // Drop any buffered batch so the closure no longer pins memory; we
      // intentionally do *not* try to flush here because the caller may be
      // disposing precisely because the network destination is going away.
      pendingBatch.length = 0;
    },

    get disposed() {
      return disposed;
    },
  };

  return binding;
}
