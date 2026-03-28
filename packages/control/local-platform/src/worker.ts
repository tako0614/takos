/**
 * Worker module for @takos/control-local-platform.
 *
 * Re-exports the platform-agnostic worker API from the parent control package,
 * then adds a direct-entrypoint guard so this file can be executed as a
 * standalone script (e.g. `tsx worker.ts`) to start the local worker loop.
 *
 * The parent `src/local-platform/worker.ts` cannot have this side-effect
 * because it is imported by tests and other modules that must not auto-start
 * a polling loop on import.
 */
import { startLocalWorkerLoop } from '../../src/local-platform/worker.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

export * from '../../src/local-platform/worker.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalWorkerLoop().catch(logEntrypointError);
}
