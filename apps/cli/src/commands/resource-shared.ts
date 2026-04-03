import fs from "node:fs/promises";
import { bold, dim } from "@std/fmt/colors";
import type { ResourceType } from "../lib/entities/resource.ts";
import { resolveSpaceId } from "../lib/cli-utils.ts";
import {
  type ApiRequestOptions,
  printJson,
  printJsonOrLog,
  requestApiOrThrow,
} from "./resource-helpers.ts";
import {
  findResourceInSpace,
  findServiceInSpace,
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
export type ResourceCreateCommandOptions = {
  type?: string;
  binding?: string;
  env: string;
  group: string;
  space?: string;
  accountId?: string;
  apiToken?: string;
  json?: boolean;
  offline?: boolean;
};
export type ResourceListCommandOptions = {
  group: string;
  space?: string;
  json?: boolean;
  offline?: boolean;
};
export type ResourceDeleteCommandOptions = {
  group: string;
  space?: string;
  accountId?: string;
  apiToken?: string;
  offline?: boolean;
};
export type ResourceListItem = {
  id?: string | null;
  name: string;
  type: string;
  group_id?: string | null;
};
export type StorePutOptions = {
  value?: string;
  file?: string;
  space?: string;
  contentType?: string;
};
export type StoreCommandSpec = {
  name: string;
  description: string;
  itemLabel: string;
  collectionPath: string;
  listErrorMessage: string;
  getErrorMessage: string;
  putErrorMessage: string;
  deleteErrorMessage: string;
  listOptionDescription: string;
  putValueDescription: string;
  putFileDescription: string;
  putBody: (
    value: string,
    options: StorePutOptions,
  ) => Record<string, unknown>;
};

export const VALID_RESOURCE_TYPES: readonly ResourceCapability[] = [
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

export const OFFLINE_RESOURCE_TYPES = new Set<ResourceCapability>([
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

const OFFLINE_CREATE_RESOURCE_TYPE_MAP: Partial<
  Record<ResourceCapability, ResourceType>
> = {
  d1: "sql",
  r2: "object_store",
  kv: "kv",
  queue: "queue",
  vectorize: "vector_index",
  secretRef: "secret",
};

export function resolveResourceType(
  input: { type?: string },
): ResourceCapability {
  if (!input.type) {
    throw new Error(`Invalid resource type: ${input.type ?? ""}`);
  }
  const normalized = RESOURCE_TYPE_ALIASES[input.type] ?? input.type;
  if (VALID_RESOURCE_TYPES.includes(normalized as ResourceCapability)) {
    return normalized as ResourceCapability;
  }
  throw new Error(`Invalid resource type: ${input.type ?? ""}`);
}

export function resolveOfflineCreateResourceType(
  resourceType: ResourceCapability,
): ResourceType {
  const mappedType = OFFLINE_CREATE_RESOURCE_TYPE_MAP[resourceType];
  if (!mappedType) {
    throw new Error(
      `Offline resource create does not support type: ${resourceType}`,
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
  if (options.value != null) {
    return options.value;
  }
  if (options.file) {
    return await fs.readFile(options.file, "utf8");
  }
  throw new Error("Provide either --value or --file");
}

type ResourceRecord = Awaited<ReturnType<typeof requireResource>>;

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

export function buildOptionalQuery(name: string, value?: string): string {
  return value ? `?${name}=${encodeURIComponent(value)}` : "";
}

export function printResourceList<T>(
  items: T[],
  options: {
    json?: boolean;
    emptyMessage: string;
    render: (item: T) => string;
  },
): void {
  if (options.json) {
    printJson(items);
    return;
  }
  if (items.length === 0) {
    console.log(dim(options.emptyMessage));
    return;
  }
  console.log("");
  console.log(bold("Resources:"));
  for (const item of items) {
    console.log(options.render(item));
  }
  console.log("");
  console.log(dim(`${items.length} resource(s)`));
}
