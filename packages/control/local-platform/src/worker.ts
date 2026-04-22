/**
 * Re-exports for takos-control-local-platform worker module.
 *
 * The canonical implementation lives in `../../src/local-platform/worker.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { startLocalWorkerLoop } from "../../src/local-platform/worker.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../src/local-platform/direct-entrypoint.ts";

export * from "../../src/local-platform/worker.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalWorkerLoop().catch(logEntrypointError);
}
