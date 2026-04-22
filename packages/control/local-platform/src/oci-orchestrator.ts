/**
 * Re-exports for takos-control-local-platform OCI orchestrator module.
 *
 * The canonical implementation lives in `../../src/local-platform/oci-orchestrator.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { startLocalOciOrchestratorServer } from "../../src/local-platform/oci-orchestrator.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../src/local-platform/direct-entrypoint.ts";

export * from "../../src/local-platform/oci-orchestrator.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalOciOrchestratorServer().catch(logEntrypointError);
}
