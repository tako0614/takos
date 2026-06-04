import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
/**
 * Node-specific HTTP server starters for the local-platform stack.
 *
 * Each `startLocal*Server()` function binds a platform-agnostic fetch factory
 * (from `runtime.ts`) to a local Node HTTP server via `fetch-server.ts`.
 * These functions are intentionally kept out of `runtime.ts` so that module
 * stays free of Node server concerns (it is also used by tests and
 * platform-agnostic code).
 */
import type { LocalFetch } from "./runtime-types.ts";
import { serveNodeFetch } from "./fetch-server.ts";
import { logInfo } from "../shared/utils/logger.ts";
import {
  createLocalWebFetch,
  DEFAULT_LOCAL_PORTS,
} from "./runtime.ts";

function resolvePort(defaultPort: number): number {
  const parsed = Number.parseInt(getEnv("PORT") ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}

function logLocalServerStart(service: string, port: number) {
  logInfo(`${service} local runtime listening on :${port}`, {
    module: "local_platform",
    adapter: getEnv("TAKOS_LOCAL_ADAPTER"),
    runtime: "node",
  });
}

export async function startCanonicalLocalServer(options: {
  service: string;
  defaultPort: number;
  createFetch: () => Promise<LocalFetch>;
}): Promise<void> {
  const port = resolvePort(options.defaultPort);
  const fetch = await options.createFetch();
  await serveNodeFetch({
    port,
    fetch,
    onListen: () => logLocalServerStart(options.service, port),
  });
}

export async function startLocalWebServer(): Promise<void> {
  await startCanonicalLocalServer({
    service: "takos",
    defaultPort: DEFAULT_LOCAL_PORTS.web,
    createFetch: createLocalWebFetch,
  });
}
