import type { Hono } from "hono";
import type { Context, Next } from "hono";
import { z } from "zod";
import { logError, logWarn } from "../shared/utils/logger.ts";
import { resolveServiceBackend } from "./oci-orchestrator-backend.ts";
import type { OciOrchestratorBackendResolver } from "./oci-orchestrator-backend.ts";
import {
  HEALTH_TIMEOUT_MS,
  performHealthCheckAndResolveEndpoint,
} from "./oci-orchestrator-health.ts";
import {
  appendServiceLog,
  containerName,
  loadState,
  logPathFor,
  readServiceLogTail,
  saveState,
  serviceKey,
} from "./oci-orchestrator-storage.ts";
import type { OciServiceRecord } from "./oci-orchestrator-storage.ts";

const DEFAULT_DOCKER_NETWORK = Deno.env.get("TAKOS_DOCKER_NETWORK") ||
  "takos-containers";

const deploySchema = z.object({
  deployment_id: z.string().min(1),
  space_id: z.string().min(1),
  artifact_ref: z.string().min(1),
  provider: z.object({
    name: z.enum(["oci", "ecs", "cloud-run", "k8s"]),
    config: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
  target: z.object({
    route_ref: z.string().min(1),
    endpoint: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("service-ref"),
        ref: z.string().min(1),
      }).strict(),
      z.object({
        kind: z.literal("http-url"),
        base_url: z.string().url(),
      }).strict(),
    ]),
    artifact: z.object({
      image_ref: z.string().min(1).optional(),
      exposed_port: z.number().int().positive().optional(),
      health_path: z.string().min(1).optional(),
    }).strict().optional(),
  }).strict(),
  runtime: z.object({
    compatibility_date: z.string().min(1).optional().nullable(),
    compatibility_flags: z.array(z.string()).default([]),
    limits: z.object({
      cpu_ms: z.number().int().positive().optional(),
      subrequests: z.number().int().positive().optional(),
    }).optional().nullable(),
  }).strict().optional(),
});

const serviceActionSchema = z.object({
  space_id: z.string().min(1),
});

type DeployPayload = z.infer<typeof deploySchema>;

export interface OciOrchestratorRouteDeps {
  backendResolver: OciOrchestratorBackendResolver;
  dockerNetwork?: string;
}

function createAuthMiddleware() {
  const token = Deno.env.get("OCI_ORCHESTRATOR_TOKEN")?.trim();
  return async (c: Context, next: Next) => {
    if (!token) {
      return next();
    }
    const auth = c.req.header("Authorization")?.trim();
    if (auth !== `Bearer ${token}`) {
      return c.text("Unauthorized", 401);
    }
    return next();
  };
}

function parseServiceAction(c: Context) {
  return serviceActionSchema.safeParse({
    space_id: c.req.query("space_id"),
  });
}

function requirePathParam(c: Context, name: string): string {
  return c.req.param(name) ?? "";
}

async function stopAndRemoveContainer(
  backendResolver: OciOrchestratorBackendResolver,
  record: OciServiceRecord,
  spaceId: string,
  routeRef: string,
): Promise<void> {
  if (!record.container_id) {
    return;
  }
  const backend = resolveServiceBackend(backendResolver, record);
  try {
    await backend.stop(record.container_id);
    await backend.remove(record.container_id);
    await appendServiceLog(
      spaceId,
      routeRef,
      `CONTAINER_REMOVED ${record.container_id}`,
    );
  } catch (err) {
    logError(`Failed to stop/remove container ${record.container_id}`, err, {
      module: "oci-orchestrator",
    });
  }
}

function createHealthHandler() {
  return (c: Context) =>
    c.json({
      status: "ok",
      service: "oci-orchestrator",
    });
}

function createDeployHandler(deps: OciOrchestratorRouteDeps) {
  return async (c: Context) => {
    const parsed = deploySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({
        error: "invalid deploy payload",
        issues: parsed.error.issues,
      }, 400);
    }

    const payload = parsed.data;
    const routeRef = payload.target.route_ref.trim();
    const now = new Date().toISOString();
    const key = serviceKey(payload.space_id, routeRef);
    const state = await loadState();
    const previous = state.services[key];
    const imageRef = payload.target.artifact?.image_ref ?? null;
    const exposedPort = payload.target.artifact?.exposed_port ?? 8080;
    const healthPath = payload.target.artifact?.health_path ?? "/health";
    const providerName = payload.provider?.name ?? "oci";
    const providerConfig = payload.provider?.config ?? null;
    const runtime: NonNullable<DeployPayload["runtime"]> = payload.runtime ?? {
      compatibility_flags: [],
    };
    const backend = deps.backendResolver({ providerName, providerConfig });

    let newContainerId: string | null = null;
    let resolvedEndpoint: { kind: "http-url"; base_url: string } | null = null;

    if (imageRef) {
      const cName = containerName(payload.space_id, routeRef);

      try {
        if (previous?.container_id) {
          await stopAndRemoveContainer(
            deps.backendResolver,
            previous,
            payload.space_id,
            routeRef,
          );
        }

        try {
          await backend.stop(cName);
          await backend.remove(cName);
        } catch (err) {
          logWarn(
            "stop/remove pre-existing container by name failed (non-critical)",
            {
              module: "oci-orchestrator",
              error: err instanceof Error ? err.message : String(err),
            },
          );
        }

        await appendServiceLog(
          payload.space_id,
          routeRef,
          `PULLING ${imageRef}`,
        );
        await backend.pullImage(imageRef);

        await appendServiceLog(
          payload.space_id,
          routeRef,
          `CREATING container ${cName}`,
        );
        const createResult = await backend.createAndStart({
          imageRef,
          name: cName,
          exposedPort,
          network: deps.dockerNetwork ?? DEFAULT_DOCKER_NETWORK,
          healthPath,
          requestedEndpoint: payload.target.endpoint,
          labels: {
            "takos.space-id": payload.space_id,
            "takos.route-ref": routeRef,
            "takos.deployment-id": payload.deployment_id,
          },
        });
        newContainerId = createResult.containerId;

        await appendServiceLog(
          payload.space_id,
          routeRef,
          `STARTED container ${newContainerId.slice(0, 12)}`,
        );

        const healthResult = await performHealthCheckAndResolveEndpoint({
          backend,
          createResult,
          containerId: newContainerId,
          containerName: cName,
          exposedPort,
          healthPath,
          timeoutMs: HEALTH_TIMEOUT_MS,
          onProgress: (line) =>
            appendServiceLog(payload.space_id, routeRef, line),
        });

        if (!healthResult.healthy) {
          await appendServiceLog(
            payload.space_id,
            routeRef,
            "HEALTH_CHECK failed, removing container",
          );
          await backend.stop(newContainerId);
          await backend.remove(newContainerId);
          return c.json({
            error: "Container health check failed",
            details: healthResult.details,
          }, 503);
        }

        resolvedEndpoint = healthResult.resolvedEndpoint;
        await appendServiceLog(
          payload.space_id,
          routeRef,
          `DEPLOYED container ${
            newContainerId.slice(0, 12)
          } → ${resolvedEndpoint.base_url}`,
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await appendServiceLog(
          payload.space_id,
          routeRef,
          `DEPLOY_ERROR ${errMsg}`,
        );
        if (newContainerId) {
          try {
            await backend.stop(newContainerId);
            await backend.remove(newContainerId);
          } catch (cleanupErr) {
            logWarn(
              "cleanup of partially created container failed (non-critical)",
              {
                module: "oci-orchestrator",
                error: cleanupErr instanceof Error
                  ? cleanupErr.message
                  : String(cleanupErr),
              },
            );
          }
        }
        return c.json({
          error: "Container deployment failed",
          details: errMsg.slice(0, 500),
        }, 500);
      }
    }

    const record: OciServiceRecord = {
      space_id: payload.space_id,
      route_ref: routeRef,
      deployment_id: payload.deployment_id,
      artifact_ref: payload.artifact_ref,
      provider_name: providerName,
      provider_config: providerConfig,
      endpoint: payload.target.endpoint,
      image_ref: imageRef,
      exposed_port: exposedPort,
      health_path: healthPath,
      container_id: newContainerId,
      resolved_endpoint: resolvedEndpoint,
      compatibility_date: runtime.compatibility_date ?? null,
      compatibility_flags: runtime.compatibility_flags ?? [],
      limits: runtime.limits ?? null,
      status: imageRef ? "deployed" : "routing-only",
      health_status: resolvedEndpoint ? "healthy" : "unknown",
      last_health_at: resolvedEndpoint ? now : null,
      last_error: null,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    };

    state.services[key] = record;
    await saveState(state);
    await appendServiceLog(
      payload.space_id,
      routeRef,
      `DEPLOY ${
        JSON.stringify({
          deployment_id: payload.deployment_id,
          artifact_ref: payload.artifact_ref,
          provider: payload.provider ?? { name: "oci" },
          target: payload.target,
          runtime,
        })
      }`,
    );

    return c.json({
      ok: true,
      service: record,
      resolved_endpoint: resolvedEndpoint,
      logs_ref: logPathFor(payload.space_id, routeRef),
    });
  };
}

function createGetServiceHandler() {
  return async (c: Context) => {
    const query = parseServiceAction(c);
    if (!query.success) {
      return c.json({ error: "space_id is required" }, 400);
    }

    const routeRef = requirePathParam(c, "routeRef");
    const key = serviceKey(query.data.space_id, routeRef);
    const state = await loadState();
    const record = state.services[key];
    if (!record) {
      return c.json({ error: "Service not found" }, 404);
    }
    return c.json({ service: record });
  };
}

function createRemoveServiceHandler(deps: OciOrchestratorRouteDeps) {
  return async (c: Context) => {
    const query = parseServiceAction(c);
    if (!query.success) {
      return c.json({ error: "space_id is required" }, 400);
    }

    const routeRef = requirePathParam(c, "routeRef");
    const key = serviceKey(query.data.space_id, routeRef);
    const state = await loadState();
    const record = state.services[key];
    if (!record) {
      return c.json({ error: "Service not found" }, 404);
    }

    if (record.container_id) {
      await stopAndRemoveContainer(
        deps.backendResolver,
        record,
        query.data.space_id,
        routeRef,
      );
    }

    const updated: OciServiceRecord = {
      ...record,
      status: "removed",
      container_id: null,
      resolved_endpoint: null,
      updated_at: new Date().toISOString(),
    };
    state.services[key] = updated;
    await saveState(state);
    await appendServiceLog(query.data.space_id, routeRef, "REMOVE");
    return c.json({ ok: true, service: updated });
  };
}

function createLogsHandler(deps: OciOrchestratorRouteDeps) {
  return async (c: Context) => {
    const query = parseServiceAction(c);
    if (!query.success) {
      return c.json({ error: "space_id is required" }, 400);
    }

    const tail = Number.parseInt(c.req.query("tail") ?? "100", 10);
    const tailCount = Number.isFinite(tail) && tail > 0 ? tail : 100;
    const routeRef = requirePathParam(c, "routeRef");
    const key = serviceKey(query.data.space_id, routeRef);
    const state = await loadState();
    const record = state.services[key];
    if (!record) {
      return c.json({ error: "Service not found" }, 404);
    }

    let containerLogText = "";
    if (record.container_id && record.status === "deployed") {
      const backend = resolveServiceBackend(deps.backendResolver, record);
      try {
        containerLogText = await backend.getLogs(
          record.container_id,
          tailCount,
        );
      } catch {
        // Container may not be running
      }
    }

    const fileLogText = await readServiceLogTail(
      query.data.space_id,
      routeRef,
      tailCount,
    );
    const combined = fileLogText +
      (containerLogText ? `--- container logs ---\n${containerLogText}` : "");

    return new Response(combined || "", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  };
}

function createProxyHandler() {
  return async (c: Context) => {
    const spaceId = requirePathParam(c, "spaceId");
    const routeRef = requirePathParam(c, "routeRef");
    const key = serviceKey(spaceId, routeRef);
    const state = await loadState();
    const record = state.services[key];

    if (!record || record.status !== "deployed" || !record.resolved_endpoint) {
      return c.json({ error: "No active container for this service" }, 503);
    }

    const baseUrl = record.resolved_endpoint.base_url;
    const proxyPrefix = `/proxy/${spaceId}/${routeRef}`;
    const remainingPath = c.req.path.slice(proxyPrefix.length) || "/";
    const targetUrl = new URL(remainingPath, baseUrl);
    targetUrl.search = new URL(c.req.url).search;

    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");

    try {
      const upstream = await fetch(targetUrl.toString(), {
        method: c.req.method,
        headers,
        body: c.req.method !== "GET" && c.req.method !== "HEAD"
          ? c.req.raw.body
          : undefined,
        redirect: "manual",
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch (err) {
      return c.json({
        error: "Proxy request failed",
        details: err instanceof Error ? err.message : String(err),
      }, 502);
    }
  };
}

export function registerOciOrchestratorRoutes(
  app: Hono,
  deps: OciOrchestratorRouteDeps,
): void {
  app.use("*", createAuthMiddleware());
  app.get("/health", createHealthHandler());
  app.post("/deploy", createDeployHandler(deps));
  app.get("/services/:routeRef", createGetServiceHandler());
  app.post("/services/:routeRef/remove", createRemoveServiceHandler(deps));
  app.get("/services/:routeRef/logs", createLogsHandler(deps));
  app.all("/proxy/:spaceId/:routeRef/*", createProxyHandler());
}
