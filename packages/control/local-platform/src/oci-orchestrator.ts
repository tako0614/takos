import { startLocalOciOrchestratorServer } from '../../src/local-platform/oci-orchestrator.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

export * from '../../src/local-platform/oci-orchestrator.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalOciOrchestratorServer().catch(logEntrypointError);
}
