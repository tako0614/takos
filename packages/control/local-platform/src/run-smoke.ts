/**
 * Re-exports for takos-control-local-platform run-smoke module.
 *
 * The canonical implementation lives in `../../src/local-platform/run-smoke.ts`.
 * The entrypoint guard here enables running this file directly via tsx.
 */
import { runLocalSmokeCommand } from "../../src/local-platform/run-smoke.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../src/local-platform/direct-entrypoint.ts";

export {
  runLocalSmoke,
  runLocalSmokeCommand,
} from "../../src/local-platform/run-smoke.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  runLocalSmokeCommand().catch(logEntrypointError);
}
