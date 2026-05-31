/**
 * Re-exports for takos-worker-local-platform OCI orchestrator module.
 *
 * The canonical implementation lives in `../../../local-platform/oci-orchestrator.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { startLocalOciOrchestratorServer } from "../../../local-platform/oci-orchestrator.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../../local-platform/direct-entrypoint.ts";

export * from "../../../local-platform/oci-orchestrator.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalOciOrchestratorServer().catch(logEntrypointError);
}
