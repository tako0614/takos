import { startLocalDispatchServer } from "../../src/local-platform/local-server.ts";
import {
  isDirectEntrypoint,
  logEntrypointError,
} from "../../src/local-platform/direct-entrypoint.ts";

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalDispatchServer().catch(logEntrypointError);
}
