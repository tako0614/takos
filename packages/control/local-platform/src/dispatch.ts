import { startLocalDispatchServer } from './runtime.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalDispatchServer().catch(logEntrypointError);
}
