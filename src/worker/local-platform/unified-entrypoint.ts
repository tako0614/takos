import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';
import { startLocalWebServer } from './local-server.ts';
import { startLocalWorkerLoop } from './worker.ts';

export async function startUnifiedTakosWorker(): Promise<void> {
  await Promise.all([
    startLocalWebServer(),
    startLocalWorkerLoop(),
  ]);
}

if (await isDirectEntrypoint(import.meta.url)) {
  startUnifiedTakosWorker().catch(logEntrypointError);
}
