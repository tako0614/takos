import { startLocalWorkerLoop } from '../../src/local-platform/worker.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

export * from '../../src/local-platform/worker.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalWorkerLoop().catch(logEntrypointError);
}
