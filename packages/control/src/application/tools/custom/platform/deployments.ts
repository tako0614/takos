import type {
  ToolContext,
  ToolDefinition,
  ToolHandler,
} from "../../tool-definitions.ts";
import { generateId } from "../../../../shared/utils/index.ts";
import {
  apps,
  getDb,
  serviceCustomDomains,
  serviceDeployments,
  services,
} from "../../../../infra/db/index.ts";
import { and, desc, eq } from "drizzle-orm";
import { createOptionalCloudflareWfpBackend } from "../../../../platform/backends/cloudflare/wfp.ts";
import { deleteHostnameRouting } from "../../../services/routing/service.ts";
import { deleteManagedCustomHostname } from "../../../services/platform/custom-domains.ts";
import { getServiceRouteRecord } from "../../../services/platform/workers.ts";
import { logWarn } from "../../../../shared/utils/logger.ts";

export const WORKER_LIST: ToolDefinition = {
  name: "service_list",
  description: "List service slots in the space.",
  category: "deploy",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filter by status (optional)",
        enum: ["pending", "building", "deployed", "failed", "stopped"],
      },
      type: {
        type: "string",
        description: "Filter by type (optional)",
        enum: ["app", "service"],
      },
    },
  },
};

export const WORKER_CREATE: ToolDefinition = {
  name: "service_create",
  description:
    "Create a new service slot (app or service). Deployments are created separately from this slot.",
  category: "deploy",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Service slot name",
      },
      type: {
        type: "string",
        description: "Deployment type: app (with UI) or service (backend only)",
        enum: ["app", "service"],
      },
      description: {
        type: "string",
        description: "Description of the service",
      },
      icon: {
        type: "string",
        description: "Emoji icon for the service",
      },
      has_takos_client: {
        type: "boolean",
        description: "Whether this deployment has a Takos UI client",
      },
      takos_client_entry: {
        type: "string",
        description: "Takos client entry point (e.g., platform, viewer)",
      },
    },
    required: ["name", "type"],
  },
};

export const WORKER_DELETE: ToolDefinition = {
  name: "service_delete",
  description: "Delete a service slot and clean up its deployment artifacts.",
  category: "deploy",
  parameters: {
    type: "object",
    properties: {
      service_id: {
        type: "string",
        description: "Service ID",
      },
      confirm: {
        type: "boolean",
        description: "Confirm deletion (must be true)",
      },
    },
    required: ["service_id", "confirm"],
  },
};

async function cleanupServiceArtifacts(
  env: ToolContext["env"],
  workerId: string,
  workerRouteRef: string | null,
  artifactRefs: Iterable<string>,
): Promise<number> {
  const wfp = createOptionalCloudflareWfpBackend(env);
  if (!wfp) {
    logWarn("Skipping service artifact cleanup because WFP is not configured", {
      module: "tools/custom/platform/deployments",
      serviceId: workerId,
    });
    return 0;
  }

  const refs = new Set<string>();
  if (workerRouteRef?.trim()) refs.add(workerRouteRef.trim());
  for (const artifactRef of artifactRefs) {
    const normalized = artifactRef.trim();
    if (normalized) refs.add(normalized);
  }

  let cleaned = 0;
  for (const artifactRef of refs) {
    try {
      await wfp.workers.deleteWorker(artifactRef);
      cleaned++;
    } catch (error) {
      logWarn("Failed to delete deployment artifact", {
        module: "tools/custom/platform/deployments",
        serviceId: workerId,
        artifactRef,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return cleaned;
}

export const workerListHandler: ToolHandler = async (args, context) => {
  const status = args.status as string | undefined;
  const type = args.type as string | undefined;

  const db = getDb(context.db);

  const conditions = [eq(services.accountId, context.spaceId)];
  if (status) conditions.push(eq(services.status, status));
  if (type) conditions.push(eq(services.workerType, type));

  const workerRows = await db.select({
    id: services.id,
    workerType: services.workerType,
    status: services.status,
    hostname: services.hostname,
    routeRef: services.routeRef,
    slug: services.slug,
    createdAt: services.createdAt,
    updatedAt: services.updatedAt,
  }).from(services)
    .where(and(...conditions))
    .orderBy(desc(services.createdAt))
    .all();

  const mappedWorkers = await Promise.all(workerRows.map(async (w) => {
    const routeRef =
      (w as { routeRef?: string | null; workerName?: string | null })
        .routeRef ??
        (w as { workerName?: string | null }).workerName ??
        null;
    const appRow = await db.select({
      name: apps.name,
      icon: apps.icon,
      description: apps.description,
    })
      .from(apps).where(eq(apps.serviceId, w.id)).limit(1).get();
    const domainCount = (await db.select({ id: serviceCustomDomains.id })
      .from(serviceCustomDomains).where(
        eq(serviceCustomDomains.serviceId, w.id),
      ).all()).length;

    return {
      id: w.id,
      service_type: w.workerType,
      status: w.status,
      hostname: w.hostname,
      route_ref: routeRef,
      slug: w.slug,
      created_at: w.createdAt,
      updated_at: w.updatedAt,
      app_name: appRow?.name || null,
      app_icon: appRow?.icon || null,
      app_description: appRow?.description || null,
      custom_domain_count: domainCount,
    };
  }));

  if (mappedWorkers.length === 0) {
    return "No services found.";
  }

  const lines = mappedWorkers.map((w) => {
    const statusIcon = w.status === "deployed"
      ? "✅"
      : w.status === "building"
      ? "🔄"
      : w.status === "stopped"
      ? "⏹️"
      : w.status === "failed"
      ? "❌"
      : "⏳";
    const displayName = w.app_name || w.route_ref || w.id;
    const icon = w.app_icon || (w.service_type === "app" ? "📱" : "⚙️");
    const url = w.hostname ? `https://${w.hostname}` : null;

    const lines: string[] = [];
    lines.push(`${statusIcon} ${icon} ${displayName} (${w.service_type})`);
    lines.push(`   ID: ${w.id}`);
    lines.push(`   Status: ${w.status}`);
    if (w.route_ref) {
      lines.push(`   Route Ref: ${w.route_ref}`);
    }
    if (url) {
      lines.push(`   URL: ${url}`);
    }
    if (w.custom_domain_count > 0) {
      lines.push(`   Custom Domains: ${w.custom_domain_count}`);
    }
    if (w.app_description) {
      lines.push(`   Description: ${w.app_description}`);
    }
    const created = w.created_at ? w.created_at.split("T")[0] : "";
    const updated = w.updated_at ? w.updated_at.split("T")[0] : "";
    if (created) {
      lines.push(
        `   Created: ${created}${
          updated && updated !== created ? " | Updated: " + updated : ""
        }`,
      );
    }

    return lines.join("\n");
  });

  return `Services (${mappedWorkers.length}):\n\n${lines.join("\n\n")}`;
};

export const workerCreateHandler: ToolHandler = async (args, context) => {
  const name = args.name as string;
  const type = args.type as "app" | "service";
  const description = args.description as string || "";
  const icon = args.icon as string || (type === "app" ? "📱" : "⚙️");

  const workerId = generateId();
  const timestamp = new Date().toISOString();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32);

  const db = getDb(context.db);

  await db.insert(services).values({
    id: workerId,
    accountId: context.spaceId,
    serviceType: type,
    status: "pending",
    slug,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();

  if (type === "app") {
    const appId = generateId();
    await db.insert(apps).values({
      id: appId,
      accountId: context.spaceId,
      serviceId: workerId,
      name,
      description,
      icon,
      appType: "custom",
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run();
  }

  return [
    "Service slot created.",
    `ID: ${workerId}`,
    `Name: ${name}`,
    `Type: ${type}`,
    "",
    "Create a deployment separately by POSTing a bundle to:",
    `/api/services/${workerId}/deployments`,
    "Example body:",
    '{"bundle":"<compiled service bundle>","strategy":"direct"}',
  ].join("\n");
};

export const workerDeleteHandler: ToolHandler = async (args, context) => {
  const workerId = args.service_id as string;
  const confirm = args.confirm as boolean;

  if (!confirm) {
    throw new Error("Must set confirm=true to delete");
  }

  const db = getDb(context.db);

  const workerRow = await getServiceRouteRecord(context.db, workerId);

  if (!workerRow || workerRow.accountId !== context.spaceId) {
    throw new Error(`Service not found: ${workerId}`);
  }

  const workerCustomDomains = await db.select({
    domain: serviceCustomDomains.domain,
    cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
  })
    .from(serviceCustomDomains).where(
      eq(serviceCustomDomains.serviceId, workerId),
    ).all();
  const workerDeployments = await db.select({
    artifactRef: serviceDeployments.artifactRef,
  })
    .from(serviceDeployments).where(eq(serviceDeployments.serviceId, workerId))
    .all();

  const { env } = context;

  for (const customDomain of workerCustomDomains) {
    if (customDomain.domain) {
      try {
        await deleteHostnameRouting({
          env,
          hostname: customDomain.domain.toLowerCase(),
        });
      } catch {
        // Best-effort cleanup
      }
    }
    if (customDomain.cfCustomHostnameId) {
      try {
        await deleteManagedCustomHostname(
          env,
          customDomain.cfCustomHostnameId,
        );
      } catch {
        // Best-effort cleanup
      }
    }
  }

  if (workerRow.hostname) {
    try {
      await deleteHostnameRouting({
        env,
        hostname: workerRow.hostname.toLowerCase(),
      });
    } catch {
      // Best-effort cleanup
    }
  }

  const cleanedArtifactCount = await cleanupServiceArtifacts(
    env,
    workerId,
    workerRow.routeRef,
    workerDeployments.map((deployment) => deployment.artifactRef ?? ""),
  );

  await db.delete(serviceCustomDomains)
    .where(eq(serviceCustomDomains.serviceId, workerId))
    .run();
  await db.delete(serviceDeployments)
    .where(eq(serviceDeployments.serviceId, workerId))
    .run();
  await db.delete(apps)
    .where(eq(apps.serviceId, workerId))
    .run();
  await db.delete(services)
    .where(eq(services.id, workerId))
    .run();

  return [
    "Service deleted.",
    `ID: ${workerId}`,
    `Route Ref: ${workerRow.routeRef ?? "(none)"}`,
    `Removed custom domains: ${workerCustomDomains.length}`,
    `Removed deployment rows: ${workerDeployments.length}`,
    `Removed deployment artifacts: ${cleanedArtifactCount}`,
  ].join("\n");
};

export const DEPLOYMENT_TOOLS: ToolDefinition[] = [
  WORKER_LIST,
  WORKER_CREATE,
  WORKER_DELETE,
];

export const DEPLOYMENT_HANDLERS: Record<string, ToolHandler> = {
  [WORKER_LIST.name]: workerListHandler,
  [WORKER_CREATE.name]: workerCreateHandler,
  [WORKER_DELETE.name]: workerDeleteHandler,
};
