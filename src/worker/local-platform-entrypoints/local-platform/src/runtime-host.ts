import { startLocalRuntimeHostServer } from "../../../local-platform/local-server.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../../local-platform/direct-entrypoint.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalRuntimeHostServer().catch(logEntrypointError);
}
