/**
 * OCI orchestrator module for @takos/control-local-platform.
 *
 * Re-exports the platform-agnostic OCI orchestrator API from the parent
 * control package, then adds a direct-entrypoint guard so this file can be
 * executed as a standalone script (e.g. `tsx oci-orchestrator.ts`) to start
 * the local OCI orchestrator server.
 *
 * The parent `src/local-platform/oci-orchestrator.ts` cannot have this
 * side-effect because it is imported by tests and other modules that must
 * not auto-start the server on import.
 */
import { startLocalOciOrchestratorServer } from '../../src/local-platform/oci-orchestrator.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

export * from '../../src/local-platform/oci-orchestrator.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalOciOrchestratorServer().catch(logEntrypointError);
}
