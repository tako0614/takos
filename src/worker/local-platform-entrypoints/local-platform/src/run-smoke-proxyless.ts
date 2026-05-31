/**
 * Re-exports for takos-worker-local-platform run-smoke-proxyless module.
 *
 * The canonical implementation lives in `../../../local-platform/run-smoke-proxyless.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { runLocalSmokeProxylessCommand } from "../../../local-platform/run-smoke-proxyless.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../../local-platform/direct-entrypoint.ts";

export {
  runLocalSmokeProxyless,
  runLocalSmokeProxylessCommand,
} from "../../../local-platform/run-smoke-proxyless.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  runLocalSmokeProxylessCommand().catch(logEntrypointError);
}
