/**
 * Re-exports for takos-control-local-platform run-smoke-proxyless module.
 *
 * The canonical implementation lives in `../../src/local-platform/run-smoke-proxyless.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { runLocalSmokeProxylessCommand } from '../../src/local-platform/run-smoke-proxyless.ts';
import { isDirectEntrypoint, logEntrypointError } from '../../src/local-platform/direct-entrypoint.ts';

export { runLocalSmokeProxyless, runLocalSmokeProxylessCommand } from '../../src/local-platform/run-smoke-proxyless.ts';

if (await isDirectEntrypoint(import.meta.url)) {
  runLocalSmokeProxylessCommand().catch(logEntrypointError);
}
