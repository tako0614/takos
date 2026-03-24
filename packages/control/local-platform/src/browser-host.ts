import { startLocalBrowserHostServer } from './runtime.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalBrowserHostServer().catch(logEntrypointError);
}
