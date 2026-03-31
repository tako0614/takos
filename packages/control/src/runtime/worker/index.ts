// Canonical entrypoint for the takos-worker (unified background worker).
// Consolidates: runner + indexer + workflow-runner + egress.
//
// fetch  → egress proxy (SSRF-protected outbound HTTP, called via service binding)
// queue  → routes to runner / indexer / workflow-runner handlers by queue name
// scheduled → stale run recovery cron
export { createWorkerRuntime } from './runtime-factory.ts';

// Re-import locally for the default export.
import { createWorkerRuntime } from './runtime-factory.ts';
export default createWorkerRuntime();
