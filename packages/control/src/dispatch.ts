// Canonical entrypoint for the takos-dispatch worker.
// Owns tenant-domain fetch wiring; shared routing logic lives outside this path.
import { selectHttpEndpointFromHttpEndpointSet } from "./application/services/routing/service.ts";
import type { RoutingStore } from "./application/services/routing/routing-models.ts";
import type {
  DurableNamespaceBinding,
  KvStoreBinding,
  PlatformExecutionContext,
} from "./shared/types/bindings.ts";
import {
  createEnvGuard,
  validateDispatchEnv,
} from "./shared/utils/validate-env.ts";
import { logError } from "./shared/utils/logger.ts";
import {
  errorJsonResponse,
  jsonResponse,
} from "./shared/utils/http-response.ts";
import { buildWorkersDispatchPlatform } from "./platform/adapters/workers.ts";
import type { ControlPlatform } from "./platform/platform-config.ts";

type ServiceBinding = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

interface DispatchNamespace {
  get(name: string, options?: { deploymentId?: string }): ServiceBinding;
}

function getTenantWorker(
  dispatcher: NonNullable<
    ControlPlatform<DispatchEnv>["services"]["serviceRegistry"]
  >,
  name: string,
  deploymentId?: string,
): ServiceBinding {
  if (!deploymentId) return dispatcher.get(name);
  try {
    return dispatcher.get(name, { deploymentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("No such worker parameter: deploymentId")) {
      return dispatcher.get(name);
    }
    throw error;
  }
}

function buildForwardedRequestToBase(
  baseUrl: string,
  request: Request,
  headers: Headers,
): Request {
  const sourceUrl = new URL(request.url);
  const targetUrl = new URL(baseUrl);
  const basePath = targetUrl.pathname.endsWith("/")
    ? targetUrl.pathname.slice(0, -1)
    : targetUrl.pathname;
  const sourcePath = sourceUrl.pathname.startsWith("/")
    ? sourceUrl.pathname
    : `/${sourceUrl.pathname}`;
  targetUrl.pathname = `${basePath}${sourcePath}` || "/";
  targetUrl.search = sourceUrl.search;
  return new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.body,
    redirect: "manual",
  });
}

function buildTenantHeaders(request: Request, hostname: string): Headers {
  const headers = new Headers(request.headers);
  headers.delete("X-Forwarded-Host");
  headers.delete("X-Tenant-Worker");
  headers.delete("X-Tenant-Deployment");
  headers.delete("X-Tenant-Endpoint");
  headers.delete("X-Takos-Internal");
  headers.delete("X-Takos-Internal-Marker");
  headers.set("X-Forwarded-Host", hostname);
  return headers;
}

export interface DispatchEnv {
  HOSTNAME_ROUTING?: KvStoreBinding;
  ROUTING_DO?: DurableNamespaceBinding;
  ROUTING_DO_PHASE?: string;
  ROUTING_STORE?: RoutingStore;
  DISPATCHER: DispatchNamespace;
  ADMIN_DOMAIN: string;
}

// Cached environment validation guard.
const envGuard = createEnvGuard(validateDispatchEnv);

export function createDispatchWorker(
  buildPlatform: (
    env: DispatchEnv,
  ) => ControlPlatform<DispatchEnv> | Promise<ControlPlatform<DispatchEnv>> =
    buildWorkersDispatchPlatform,
) {
  return {
    async fetch(
      request: Request,
      env: DispatchEnv,
      ctx: PlatformExecutionContext,
    ): Promise<Response> {
      const platform = await buildPlatform(env);
      const envError = envGuard(platform.bindings);
      if (envError) {
        return errorJsonResponse("Configuration Error", 503, {
          message:
            "Dispatch worker is misconfigured. Please contact administrator.",
        });
      }

      const url = new URL(request.url);

      if (url.pathname === "/health" && request.method === "GET") {
        return jsonResponse({ status: "ok", service: "takos-dispatch" });
      }

      // Service-binding calls use hostname "internal"; use X-Forwarded-Host only in that case.
      const forwardedHost = request.headers.get("X-Forwarded-Host");
      const hostnameRaw = url.hostname === "internal" && forwardedHost
        ? forwardedHost
        : url.hostname;
      const hostname = hostnameRaw.trim().toLowerCase();

      if (hostname === platform.config.adminDomain) {
        return new Response("Not Found", { status: 404 });
      }

      try {
        const resolved = await platform.services.routing.resolveHostname(
          hostname,
          ctx,
        );
        const target = resolved.target;

        if (!target) {
          return errorJsonResponse("Not found", 404);
        }

        const headers = buildTenantHeaders(request, hostname);

        if (target.type === "http-endpoint-set") {
          const endpoint = selectHttpEndpointFromHttpEndpointSet(
            target.endpoints,
            url.pathname,
            request.method,
          );
          if (!endpoint) {
            logError(
              `Routing endpoint not found for hostname: ${hostname}`,
              undefined,
              {
                module: "dispatch",
                detail: { routingSource: resolved.source },
              },
            );
            return errorJsonResponse("Service unavailable", 503, {
              routingSource: resolved.source,
            });
          }

          headers.set("X-Tenant-Endpoint", endpoint.name);
          if (endpoint.target.kind === "http-url") {
            const upstreamRequest = buildForwardedRequestToBase(
              endpoint.target.baseUrl,
              request,
              headers,
            );
            return await fetch(upstreamRequest);
          }

          const routeRef = endpoint.target.ref;
          if (!routeRef) {
            return errorJsonResponse(
              "Local service target not configured",
              503,
              {
                routingSource: resolved.source,
                endpoint: endpoint.name,
              },
            );
          }
          headers.set("X-Tenant-Worker", routeRef);
          headers.set("X-Takos-Internal-Marker", "1");
          const userWorker = platform.services.serviceRegistry?.get(routeRef);
          if (!userWorker) {
            return errorJsonResponse(
              "Local service target not configured",
              503,
              {
                worker: routeRef,
                routingSource: resolved.source,
                endpoint: endpoint.name,
              },
            );
          }
          const workerRequest = new Request(request.url, {
            method: request.method,
            headers,
            body: request.body,
            redirect: "manual",
          });
          return await userWorker.fetch(workerRequest);
        }

        const deploymentTarget = platform.services.routing
          .selectDeploymentTarget(target, url.pathname, request.method);
        const routeRef = deploymentTarget?.routeRef ?? null;
        if (!routeRef || !deploymentTarget) {
          logError(
            `Routing misconfigured for hostname: ${hostname}`,
            undefined,
            {
              module: "dispatch",
              detail: { routingSource: resolved.source },
            },
          );
          return errorJsonResponse("Service unavailable", 503, {
            routingSource: resolved.source,
          });
        }
        headers.set("X-Tenant-Worker", routeRef);
        headers.set("X-Takos-Internal-Marker", "1");
        if (deploymentTarget.deploymentId) {
          headers.set("X-Tenant-Deployment", deploymentTarget.deploymentId);
        } else {
          headers.delete("X-Tenant-Deployment");
        }

        const userWorker = platform.services.serviceRegistry
          ? getTenantWorker(
            platform.services.serviceRegistry,
            routeRef,
            deploymentTarget.deploymentId,
          )
          : null;
        if (!userWorker) {
          return errorJsonResponse("Local service target not configured", 503, {
            worker: routeRef,
            routingSource: resolved.source,
          });
        }
        const workerRequest = new Request(request.url, {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
        });

        return await userWorker.fetch(workerRequest);
      } catch (error) {
        logError("error", error, { module: "dispatch" });

        const errorMessage = error instanceof Error ? error.message : "";
        const errorName = error instanceof Error ? error.name : "";
        const isNotFound = errorMessage.includes("Worker not found") ||
          errorMessage.includes("not found") ||
          errorName === "WorkerNotFound";

        if (isNotFound) {
          return errorJsonResponse("Tenant worker not found", 503, {
            message:
              "The tenant worker may be provisioning or has been deleted",
          });
        }

        return errorJsonResponse("Dispatch failed", 500, {
          message: "An error occurred while routing to the tenant",
        });
      }
    },
  };
}

export const dispatchWorker = createDispatchWorker();

export default dispatchWorker;
