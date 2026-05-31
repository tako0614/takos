/**
 * Re-exports for takos-worker-local-platform run-smoke module.
 *
 * The canonical implementation lives in `../../../local-platform/run-smoke.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { runLocalSmokeCommand } from "../../../local-platform/run-smoke.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../../local-platform/direct-entrypoint.ts";

export {
  runLocalSmoke,
  runLocalSmokeCommand,
} from "../../../local-platform/run-smoke.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  runLocalSmokeCommand().catch(logEntrypointError);
}
