import { startLocalWebServer } from './runtime.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalWebServer().catch(logEntrypointError);
}
