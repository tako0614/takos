/**
 * Non-Cloudflare implementation of the AnalyticsEngine binding.
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
  mode?: 'otel' | 'buffer' | 'noop';
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createAnalyticsEngineBinding(config: AnalyticsEngineConfig): AnalyticsEngineDataset & { getBuffer(): AnalyticsEngineDataPoint[] } {
  const mode = config.mode ?? (config.otelEndpoint ? 'otel' : 'noop');
  const buffer: AnalyticsEngineDataPoint[] = [];

  // Batched OTEL flush
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingBatch: AnalyticsEngineDataPoint[] = [];

  function flushToOtel() {
    if (pendingBatch.length === 0 || !config.otelEndpoint) return;

    const batch = pendingBatch.splice(0);
    const body = JSON.stringify({
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: `takos-analytics:${config.dataset}` } }] },
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  }

  return {
    writeDataPoint(event: AnalyticsEngineDataPoint): void {
      switch (mode) {
        case 'buffer':
          buffer.push(event);
          break;
        case 'otel':
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
        case 'noop':
        default:
          break;
      }
    },

    /** Access the in-memory buffer (only useful in 'buffer' mode). */
    getBuffer(): AnalyticsEngineDataPoint[] {
      return buffer;
    },
  };
}
