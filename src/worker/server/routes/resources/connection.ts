import { Hono } from "hono";
import type { AuthenticatedRouteEnv } from "../route-auth.ts";
import {
  getResourceById,
  getResourceByName,
} from "../../../application/services/resources/index.ts";
import {
  AuthorizationError,
  NotFoundError,
} from "@takos/worker-platform-utils/errors";

function parseResourceConfig(config: unknown): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === "string") {
    try {
      return JSON.parse(config) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return typeof config === "object" && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {};
}

function portableConnectionUrl(resource: {
  backend_name?: string | null;
  type: string;
  backing_resource_id?: string | null;
  backing_resource_name?: string | null;
}): string {
  const backend = resource.backend_name || "takos";
  const target = resource.backing_resource_name ||
    resource.backing_resource_id || "";
  return `takos+${resource.type}://${backend}/${target}`;
}

function buildConnectionInfo(resource: {
  id?: string;
  _internal_id?: string;
  type: string;
  backend_name?: string | null;
  backing_resource_id?: string | null;
  backing_resource_name?: string | null;
  config?: unknown;
}): Record<string, string> {
  const connectionInfo: Record<string, string> = {};
  const backendName = resource.backend_name || "cloudflare";
  const config = parseResourceConfig(resource.config);
  const durableConfig =
    typeof config.durableObject === "object" && config.durableObject
      ? config.durableObject as Record<string, unknown>
      : typeof config.durableNamespace === "object" && config.durableNamespace
      ? config.durableNamespace as Record<string, unknown>
      : config;

  switch (resource.type) {
    case "sql":
      connectionInfo.database_id = resource.backing_resource_id || "";
      connectionInfo.database_name = resource.backing_resource_name || "";
      connectionInfo.connection_url = backendName === "cloudflare"
        ? `d1://${resource.backing_resource_id || ""}`
        : portableConnectionUrl(resource);
      break;
    case "object-store":
      connectionInfo.bucket_name = resource.backing_resource_name || "";
      connectionInfo.access_url = backendName === "cloudflare"
        ? `https://${
          resource.backing_resource_name || ""
        }.r2.cloudflarestorage.com`
        : portableConnectionUrl(resource);
      break;
    case "key-value":
      connectionInfo.namespace_id = resource.backing_resource_id || "";
      connectionInfo.namespace_name = resource.backing_resource_name || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "queue":
      connectionInfo.queue_id = resource.backing_resource_id || "";
      connectionInfo.queue_name = resource.backing_resource_name || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "vector-index":
      connectionInfo.index_name = resource.backing_resource_name || "";
      connectionInfo.index_id = resource.backing_resource_id || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "analytics-engine":
      connectionInfo.dataset = resource.backing_resource_name ||
        resource.backing_resource_id || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "workflow":
      connectionInfo.workflow_name = resource.backing_resource_name ||
        resource.backing_resource_id || "";
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "durable-object":
      connectionInfo.class_name = typeof durableConfig.className === "string"
        ? durableConfig.className
        : "";
      if (typeof durableConfig.scriptName === "string") {
        connectionInfo.script_name = durableConfig.scriptName;
      }
      connectionInfo.connection_url = portableConnectionUrl(resource);
      break;
    case "secret":
      connectionInfo.secret_name = resource.backing_resource_name || "";
      connectionInfo.resource_id = resource.backing_resource_id ||
        resource.id || resource._internal_id || "";
      break;
    default:
      connectionInfo.resource_id = resource.backing_resource_id ||
        resource.id || resource._internal_id || "";
  }

  return connectionInfo;
}

const resourcesConnection = new Hono<AuthenticatedRouteEnv>()
  .get("/:id/connection", async (c) => {
    const user = c.get("user");
    const resourceId = c.req.param("id");

    const resource = await getResourceById(c.env.DB, resourceId);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    if (resource.owner_id !== user.id) {
      throw new AuthorizationError("Only the owner can view connection info");
    }

    return c.json({
      type: resource.type,
      name: resource.name,
      status: resource.status,
      connection: buildConnectionInfo(resource),
    });
  })
  .get("/by-name/:name/connection", async (c) => {
    const user = c.get("user");
    const resourceName = c.req.param("name");

    const resource = await getResourceByName(c.env.DB, user.id, resourceName);

    if (!resource) {
      throw new NotFoundError("Resource");
    }

    return c.json({
      type: resource.type,
      name: resource.name,
      status: resource.status,
      connection: buildConnectionInfo(resource),
    });
  });

export default resourcesConnection;
