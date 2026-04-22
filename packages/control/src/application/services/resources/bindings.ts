import type { D1Database } from "../../../shared/types/bindings.ts";
import { getDb, serviceBindings, services } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import { toApiServiceBinding } from "./format.ts";
import { getResourceById } from "./store.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { getPortableSecretValue } from "./portable-runtime.ts";

export const resourceBindingDeps = {
  getDb,
  getResourceById,
  getPortableSecretValue,
};

function sanitizePortableName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitized || "resource";
}

function derivePortableQueueSubscriptionName(name: string): string {
  return `${sanitizePortableName(name)}-subscription`;
}

function parseResourceConfig(
  config?: string | Record<string, unknown> | null,
): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === "string") {
    try {
      return JSON.parse(config) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return config;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export async function listServiceBindings(db: D1Database, resourceId: string) {
  const drizzle = resourceBindingDeps.getDb(db);

  const bindingsResult = await drizzle.select({
    id: serviceBindings.id,
    serviceId: serviceBindings.serviceId,
    resourceId: serviceBindings.resourceId,
    bindingName: serviceBindings.bindingName,
    bindingType: serviceBindings.bindingType,
    config: serviceBindings.config,
    createdAt: serviceBindings.createdAt,
    serviceHostname: services.hostname,
    serviceSlug: services.slug,
    serviceStatus: services.status,
  }).from(serviceBindings)
    .leftJoin(services, eq(serviceBindings.serviceId, services.id))
    .where(eq(serviceBindings.resourceId, resourceId))
    .orderBy(serviceBindings.createdAt)
    .all();

  return bindingsResult.map((wb) => ({
    ...toApiServiceBinding({
      id: wb.id,
      serviceId: wb.serviceId,
      resourceId: wb.resourceId,
      bindingName: wb.bindingName,
      bindingType: wb.bindingType,
      config: wb.config,
      createdAt: textDate(wb.createdAt),
    }),
    service_hostname: wb.serviceHostname,
    service_slug: wb.serviceSlug,
    service_status: wb.serviceStatus,
  }));
}

export async function countServiceBindings(db: D1Database, resourceId: string) {
  const drizzle = resourceBindingDeps.getDb(db);
  const { count } = await import("drizzle-orm");
  const result = await drizzle.select({ count: count() }).from(serviceBindings)
    .where(eq(serviceBindings.resourceId, resourceId))
    .get();
  return { count: result?.count ?? 0 };
}

export async function createServiceBinding(
  db: D1Database,
  input: {
    id: string;
    service_id: string;
    resource_id: string;
    binding_name: string;
    binding_type: string;
    config: Record<string, unknown>;
    created_at: string;
  },
) {
  const drizzle = resourceBindingDeps.getDb(db);
  await drizzle.insert(serviceBindings).values({
    id: input.id,
    serviceId: input.service_id,
    resourceId: input.resource_id,
    bindingName: input.binding_name,
    bindingType: input.binding_type,
    config: JSON.stringify(input.config || {}),
    createdAt: input.created_at,
  });
}

export async function deleteServiceBinding(
  db: D1Database,
  resourceId: string,
  serviceId: string,
) {
  const drizzle = resourceBindingDeps.getDb(db);
  await drizzle.delete(serviceBindings)
    .where(and(
      eq(serviceBindings.resourceId, resourceId),
      eq(serviceBindings.serviceId, serviceId),
    ));
}

export const listResourceBindings = listServiceBindings;
export const countResourceBindings = countServiceBindings;
export const createWorkerBinding = createServiceBinding;
export const deleteWorkerBinding = deleteServiceBinding;

export async function buildBindingFromResource(
  db: D1Database,
  resourceId: string,
  bindingName: string,
): Promise<
  {
    type:
      | "d1"
      | "r2"
      | "kv"
      | "queue"
      | "analytics_engine"
      | "workflow"
      | "vectorize"
      | "durable_object_namespace"
      | "secret_text";
    name: string;
    id?: string;
    bucket_name?: string;
    namespace_id?: string;
    queue_name?: string;
    dataset?: string;
    workflow_name?: string;
    index_name?: string;
    class_name?: string;
    script_name?: string;
    queue_backend?: "sqs" | "pubsub" | "redis" | "persistent";
    queue_url?: string;
    subscription_name?: string;
    backend_name?: string;
    text?: string;
  } | null
> {
  const resource = await resourceBindingDeps.getResourceById(db, resourceId);

  if (!resource || resource.status !== "active") {
    return null;
  }

  const resourceType = String(resource.type);

  switch (resourceType) {
    case "d1":
      return {
        type: "d1",
        name: bindingName,
        id: resource.backing_resource_id ?? undefined,
      };

    case "r2":
      return {
        type: "r2",
        name: bindingName,
        bucket_name: resource.backing_resource_name ?? undefined,
      };

    case "kv":
      return {
        type: "kv",
        name: bindingName,
        namespace_id: resource.backing_resource_id ?? undefined,
      };

    case "vectorize":
      return {
        type: "vectorize",
        name: bindingName,
        index_name: resource.backing_resource_name ?? undefined,
      };
    case "queue":
      return {
        type: "queue",
        name: bindingName,
        queue_name: resource.backing_resource_name ??
          resource.backing_resource_id ?? undefined,
        ...(resource.backend_name === "aws"
          ? {
            queue_backend: "sqs" as const,
            queue_url: resource.backing_resource_id ?? undefined,
            backend_name: "aws" as const,
          }
          : {}),
        ...(resource.backend_name === "gcp"
          ? {
            queue_backend: "pubsub" as const,
            subscription_name: derivePortableQueueSubscriptionName(
              resource.backing_resource_name ?? resource.id,
            ),
            backend_name: "gcp" as const,
          }
          : {}),
        ...(resource.backend_name === "k8s"
          ? {
            queue_backend: "redis" as const,
            backend_name: "k8s" as const,
          }
          : {}),
      };
    case "analytics_engine":
    case "analyticsEngine":
      return {
        type: "analytics_engine",
        name: bindingName,
        dataset: resource.backing_resource_name ??
          resource.backing_resource_id ?? undefined,
      };
    case "workflow":
    case "workflow_runtime": {
      const config = parseResourceConfig(resource.config);
      const workflowConfig = asObject(config.workflowRuntime) ??
        asObject(config.workflow);
      const workflowName = nonEmptyString(config.workflowName) ??
        nonEmptyString(config.workflow_name) ??
        nonEmptyString(workflowConfig?.export) ??
        nonEmptyString(workflowConfig?.name) ??
        resource.backing_resource_name ??
        resource.backing_resource_id ??
        undefined;
      if (!workflowName) return null;
      return {
        type: "workflow",
        name: bindingName,
        workflow_name: workflowName,
      };
    }

    case "secretRef":
      return {
        type: "secret_text",
        name: bindingName,
        text: resource.backend_name && resource.backend_name !== "cloudflare"
          ? await resourceBindingDeps.getPortableSecretValue({
            id: resource.id,
            backend_name: resource.backend_name,
            backing_resource_id: resource.backing_resource_id,
            backing_resource_name: resource.backing_resource_name,
            ...(resource.config ? { config: resource.config } : {}),
          })
          : resource.backing_resource_id ?? "",
      };

    case "durableObject":
    case "durable-object":
    case "durable_namespace":
    case "durable_object": {
      const config = parseResourceConfig(resource.config);
      const durableObject = asObject(config.durableObject);
      const durableNamespace = asObject(config.durableNamespace);
      const className = nonEmptyString(config.className) ??
        nonEmptyString(durableObject?.className) ??
        nonEmptyString(durableNamespace?.className) ??
        resource.backing_resource_name ??
        undefined;
      if (!className) return null;
      const scriptName = nonEmptyString(config.scriptName) ??
        nonEmptyString(durableObject?.scriptName) ??
        nonEmptyString(durableNamespace?.scriptName);
      return {
        type: "durable_object_namespace",
        name: bindingName,
        class_name: className,
        ...(scriptName ? { script_name: scriptName } : {}),
      };
    }

    default:
      return null;
  }
}
