/**
 * Re-exports for takos-worker-local-platform worker module.
 *
 * The canonical implementation lives in `../../../local-platform/worker.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { startLocalWorkerLoop } from "../../../local-platform/worker.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../../local-platform/direct-entrypoint.ts";

export * from "../../../local-platform/worker.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalWorkerLoop().catch(logEntrypointError);
}
