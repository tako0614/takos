/**
 * Non-Cloudflare implementation of the AnalyticsEngine binding.
 *
 * Supports three backends controlled by configuration:
 * - **otel**: Sends data points to an OpenTelemetry collector endpoint
 * - **buffer**: Accumulates data points in-memory (for local dev / debugging)
 * - **noop**: Silently discards data points (default)
 */
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
export declare function createAnalyticsEngineBinding(config: AnalyticsEngineConfig): AnalyticsEngineDataset & {
    getBuffer(): AnalyticsEngineDataPoint[];
};
//# sourceMappingURL=analytics-engine-binding.d.ts.map