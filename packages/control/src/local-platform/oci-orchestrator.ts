import { Hono } from "hono";
import { logInfo } from "../shared/utils/logger.ts";
import { serveNodeFetch } from "./fetch-server.ts";
import type { ContainerBackend } from "./container-backend.ts";
import { isDirectEntrypoint, logEntrypointError } from "./direct-entrypoint.ts";
import { registerOciOrchestratorRoutes } from "./oci-orchestrator-handlers.ts";
import {
  createDefaultOciOrchestratorBackendResolver,
} from "./oci-orchestrator-backend.ts";
import type {
  OciOrchestratorBackendResolver,
} from "./oci-orchestrator-backend.ts";
import { resolveDataDir, resolvePort } from "./oci-orchestrator-storage.ts";

export { createDefaultOciOrchestratorBackendResolver } from "./oci-orchestrator-backend.ts";
export type {
  OciOrchestratorBackendResolver,
  OciOrchestratorBackendResolverInput,
} from "./oci-orchestrator-backend.ts";

// ─── Options for app creation ───

export interface OciOrchestratorAppOptions {
  /** Fixed backend to use for every provider. Preserved for tests and explicit overrides. */
  backend?: ContainerBackend;
  /** Resolve a backend from the requested provider. Defaults to a provider-aware resolver. */
  backendResolver?: OciOrchestratorBackendResolver;
}

// ─── App factory ───

export function createLocalOciOrchestratorApp(
  options?: OciOrchestratorAppOptions,
): Hono {
  const backendResolver = options?.backendResolver ??
    (options?.backend
      ? (() => options.backend!)
      : createDefaultOciOrchestratorBackendResolver());
  const app = new Hono();
  registerOciOrchestratorRoutes(app, { backendResolver });
  return app;
}

export async function createLocalOciOrchestratorFetchForTests(
  options?: OciOrchestratorAppOptions,
): Promise<(request: Request) => Promise<Response>> {
  const app = createLocalOciOrchestratorApp(options);
  return (request: Request) => Promise.resolve(app.fetch(request));
}

export async function startLocalOciOrchestratorServer(
  options?: OciOrchestratorAppOptions,
): Promise<void> {
  const port = resolvePort();
  const app = createLocalOciOrchestratorApp(options);
  await serveNodeFetch({
    fetch: app.fetch.bind(app),
    port,
    onListen: () => {
      logInfo("oci-orchestrator local runtime started", {
        module: "local_oci_orchestrator",
        port,
        dataDir: resolveDataDir(),
        backend: options?.backend
          ? (options.backend.constructor?.name ?? "custom-backend")
          : options?.backendResolver
          ? "custom-resolver"
          : "provider-aware-default",
      });
    },
  });
}

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalOciOrchestratorServer().catch(logEntrypointError);
}
