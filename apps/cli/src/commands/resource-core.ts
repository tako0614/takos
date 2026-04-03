import fs from "node:fs/promises";
import { bold, dim, green } from "@std/fmt/colors";
import type { ResourceType } from "../lib/entities/resource.ts";
import {
  resolveAccountId,
  resolveApiToken,
  resolveSpaceId,
} from "../lib/cli-utils.ts";
import {
  type ApiRequestOptions,
  printJson,
  printJsonOrLog,
  requestApiOrThrow,
} from "./resource-helpers.ts";
import {
  ensureGroupInSpace,
  findResourceInSpace,
  findServiceInSpace,
  listResourcesInSpace,
  setResourceGroup,
} from "../lib/platform-surface.ts";

export type ResourceCapability =
  | "d1"
  | "r2"
  | "kv"
  | "queue"
  | "vectorize"
  | "secretRef"
  | "analyticsEngine"
  | "workflow"
  | "durableObject";

export type ResourceCommandOptions = { space?: string };
export type ResourceJsonCommandOptions = ResourceCommandOptions & {
  json?: boolean;
};
export type ResourceTargetOptions = ResourceCommandOptions & {
  worker?: string;
  service?: string;
};

export type ResourceCreateCommandOptions = ResourceJsonCommandOptions & {
  type?: string;
  binding?: string;
  env: string;
  group?: string;
  accountId?: string;
  apiToken?: string;
  offline?: boolean;
};

export type ResourceListCommandOptions = ResourceJsonCommandOptions & {
  group: string;
  offline?: boolean;
};

export type ResourceDeleteCommandOptions = {
  group: string;
  space?: string;
  accountId?: string;
  apiToken?: string;
  offline?: boolean;
};

export type StorePutOptions = {
  value?: string;
  file?: string;
  space?: string;
  contentType?: string;
};

export type StoreCommandSpec = {
  noun: string;
  pathPrefix: string;
  listError: string;
  readError: string;
  writeError: string;
  deleteError: string;
  writeSuccess: (name: string, key: string) => string;
  deleteSuccess: (name: string, key: string) => string;
  includeContentType?: boolean;
};

export type ResourceListItem = {
  id?: string | null;
  name: string;
  type: string;
  group_id?: string | null;
};

export const VALID_RESOURCE_TYPES: ResourceCapability[] = [
  "d1",
  "r2",
  "kv",
  "queue",
  "vectorize",
  "secretRef",
  "analyticsEngine",
  "workflow",
  "durableObject",
];

const OFFLINE_RESOURCE_TYPES = new Set<ResourceCapability>([
  "d1",
  "r2",
  "kv",
  "queue",
  "vectorize",
  "secretRef",
]);

const RESOURCE_TYPE_ALIASES: Record<string, ResourceCapability> = {
  sql: "d1",
  object_store: "r2",
  vector_index: "vectorize",
  secret: "secretRef",
  analytics_store: "analyticsEngine",
  workflow_runtime: "workflow",
  durable_namespace: "durableObject",
};

const OFFLINE_RESOURCE_TYPE_MAP: Partial<
  Record<ResourceCapability, ResourceType>
> = {
  d1: "sql",
  r2: "object_store",
  kv: "kv",
  queue: "queue",
  vectorize: "vector_index",
  secretRef: "secret",
};

export function resolveResourceType(input: {
  type?: string;
}): ResourceCapability {
  if (!input.type) {
    throw new Error(`Invalid resource type: ${input.type ?? ""}`);
  }

  const normalized = RESOURCE_TYPE_ALIASES[input.type] ?? input.type;
  if (VALID_RESOURCE_TYPES.includes(normalized as ResourceCapability)) {
    return normalized as ResourceCapability;
  }

  throw new Error(`Invalid resource type: ${input.type ?? ""}`);
}

function resolveOfflineCreateResourceType(
  resourceType: ResourceCapability,
): ResourceType {
  if (!OFFLINE_RESOURCE_TYPES.has(resourceType)) {
    throw new Error(
      `Offline resource create does not support type: ${resourceType}`,
    );
  }

  const mappedType = OFFLINE_RESOURCE_TYPE_MAP[resourceType];
  if (!mappedType) {
    throw new Error(
      `Unsupported resource type for offline create: ${resourceType}`,
    );
  }

  return mappedType;
}

export async function requireResource(spaceId: string, name: string) {
  const resource = await findResourceInSpace(spaceId, name);
  if (!resource) {
    throw new Error(`Resource not found: ${name}`);
  }
  return resource;
}

export async function requireTargetService(
  spaceId: string,
  worker?: string,
  serviceName?: string,
) {
  if (!worker && !serviceName) {
    throw new Error("Specify either --worker or --service");
  }
  if (worker && serviceName) {
    throw new Error("Use only one of --worker or --service");
  }

  const service = worker
    ? await findServiceInSpace(spaceId, worker, "app")
    : await findServiceInSpace(spaceId, serviceName!, "service");

  if (!service) {
    throw new Error(`Workload not found: ${worker ?? serviceName}`);
  }

  return service;
}

export async function readTextValue(
  options: { value?: string; file?: string },
): Promise<string> {
  if (options.value != null) return options.value;
  if (options.file) return fs.readFile(options.file, "utf8");
  throw new Error("Provide either --value or --file");
}

export type ResourceRecord = Awaited<ReturnType<typeof requireResource>>;

export async function withResolvedResource<
  TOptions extends ResourceCommandOptions,
  TResult,
>(
  name: string,
  options: TOptions,
  action: (
    context: {
      options: TOptions;
      resource: ResourceRecord;
      spaceId: string;
    },
  ) => Promise<TResult>,
): Promise<TResult> {
  const spaceId = resolveSpaceId(options.space);
  const resource = await requireResource(spaceId, name);
  return await action({ options, resource, spaceId });
}

export async function requestResourceByIdApi<T>(
  resourceId: string,
  suffix = "",
  options?: ApiRequestOptions,
): Promise<T> {
  return await requestApiOrThrow<T>(
    `/api/resources/${encodeURIComponent(resourceId)}${suffix}`,
    options,
  );
}

export async function requestNamedResourceApi<
  T,
  TOptions extends ResourceCommandOptions,
>(
  name: string,
  options: TOptions,
  suffix = "",
  requestOptions?: ApiRequestOptions,
): Promise<T> {
  return await withResolvedResource(
    name,
    options,
    async ({ resource }) =>
      await requestResourceByIdApi<T>(resource.id, suffix, requestOptions),
  );
}

export async function printNamedResourceApiResponse<
  TOptions extends ResourceJsonCommandOptions,
>(
  name: string,
  options: TOptions,
  suffix = "",
  requestOptions?: ApiRequestOptions,
): Promise<void> {
  const data = await requestNamedResourceApi<unknown, TOptions>(
    name,
    options,
    suffix,
    requestOptions,
  );
  printJsonOrLog(data, options.json);
}

export async function withResolvedBindingTarget<
  TOptions extends ResourceTargetOptions,
>(
  name: string,
  options: TOptions,
  action: (
    context: {
      resource: ResourceRecord;
      target: Awaited<ReturnType<typeof requireTargetService>>;
    },
  ) => Promise<void>,
) {
  await withResolvedResource(name, options, async ({ resource, spaceId }) => {
    const target = await requireTargetService(
      spaceId,
      options.worker,
      options.service,
    );
    await action({ resource, target });
  });
}

export function buildOptionalQuery(name: string, value?: string): string {
  return value ? `?${name}=${encodeURIComponent(value)}` : "";
}

export function printCreatedResource(
  result: {
    id?: string | null;
    name: string;
    type: string;
    status: string;
  },
  options: ResourceJsonCommandOptions,
  groupName?: string,
) {
  if (options.json) {
    printJson({ resource: result });
    return;
  }

  const idInfo = result.id ? dim(` (${result.id})`) : "";
  console.log(
    `${green("✓")} ${result.name} [${result.type}] ${result.status}${idInfo}`,
  );
  if (groupName) {
    console.log(dim(`  group=${groupName}`));
  }
}

export function printResourceList(
  resources: ResourceListItem[],
  emptyMessage: string,
  json?: boolean,
): void {
  if (json) {
    printJson(resources);
    return;
  }

  if (resources.length === 0) {
    console.log(dim(emptyMessage));
    return;
  }

  console.log("");
  console.log(bold("Resources:"));
  for (const resource of resources) {
    const idLabel = resource.id ? dim(` (${resource.id})`) : "";
    const groupLabel = resource.group_id
      ? dim(` group=${resource.group_id}`)
      : "";
    console.log(`  ${resource.name} [${resource.type}]${idLabel}${groupLabel}`);
  }
  console.log("");
  console.log(dim(`${resources.length} resource(s)`));
}

export async function createOfflineResource(
  name: string,
  resourceType: ResourceCapability,
  options: ResourceCreateCommandOptions,
): Promise<void> {
  const { createResource } = await import("../lib/entities/resource.ts");
  const groupName = options.group ?? "takos";
  const result = await createResource(name, {
    type: resolveOfflineCreateResourceType(resourceType),
    binding: options.binding,
    env: options.env,
    group: groupName,
    groupName,
    accountId: resolveAccountId(options.accountId),
    apiToken: resolveApiToken(options.apiToken),
  });

  printCreatedResource(result, options);
}

export async function createOnlineResource(
  name: string,
  resourceType: ResourceCapability,
  options: ResourceCreateCommandOptions,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const group = options.group
    ? await ensureGroupInSpace(spaceId, options.group)
    : null;
  const result = await requestApiOrThrow<{
    resource: { id: string; name: string; type: string; status: string };
  }>("/api/resources", {
    method: "POST",
    body: {
      name,
      type: resourceType,
      space_id: spaceId,
      group_id: group?.id ?? null,
      config: {
        ...(options.binding ? { binding: options.binding } : {}),
        env: options.env,
      },
    },
  });

  if (options.json) {
    printJson(result);
    return;
  }

  printCreatedResource(result.resource, options, group?.name);
}

export async function listOfflineResourcesForCommand(
  options: ResourceListCommandOptions,
) {
  const { listResources } = await import("../lib/entities/resource.ts");
  return await listResources(options.group);
}

export async function listOnlineResourcesForCommand(
  options: ResourceListCommandOptions,
) {
  return await listResourcesInSpace(resolveSpaceId(options.space));
}

export async function deleteOfflineResourceForCommand(
  name: string,
  options: ResourceDeleteCommandOptions,
) {
  const { deleteResource } = await import("../lib/entities/resource.ts");
  await deleteResource(name, {
    group: options.group,
    accountId: resolveAccountId(options.accountId),
    apiToken: resolveApiToken(options.apiToken),
  });
  console.log(green(`Removed resource '${name}' from offline state.`));
}

export async function deleteOnlineResourceForCommand(
  name: string,
  options: ResourceDeleteCommandOptions,
) {
  const resource = await requireResource(resolveSpaceId(options.space), name);
  await requestResourceByIdApi(resource.id, "", { method: "DELETE" });
  console.log(green(`Deleted resource '${name}'.`));
}

export async function attachResourceToGroup(
  name: string,
  options: { group: string; space?: string },
) {
  const spaceId = resolveSpaceId(options.space);
  const resource = await requireResource(spaceId, name);
  const group = await ensureGroupInSpace(spaceId, options.group);
  await setResourceGroup(resource.id, group.id);
  console.log(
    green(`Attached resource '${name}' to group '${group.name}'.`),
  );
}

export async function detachResourceFromGroup(
  name: string,
  options: { space?: string },
) {
  const spaceId = resolveSpaceId(options.space);
  const resource = await requireResource(spaceId, name);
  await setResourceGroup(resource.id, null);
  console.log(green(`Detached resource '${name}' from its group.`));
}
