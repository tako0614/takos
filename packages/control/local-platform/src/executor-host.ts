import { startLocalExecutorHostServer } from './runtime.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalExecutorHostServer().catch(logEntrypointError);
}
