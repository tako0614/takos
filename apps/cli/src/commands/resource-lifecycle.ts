import { dim, green } from "@std/fmt/colors";
import type { Command } from "commander";
import {
  resolveAccountId,
  resolveApiToken,
  resolveSpaceId,
} from "../lib/cli-utils.ts";
import {
  ensureGroupInSpace,
  listResourcesInSpace,
  setResourceGroup,
} from "../lib/platform-surface.ts";
import {
  printJson,
  requestApiOrThrow,
  withCommandError,
} from "./resource-helpers.ts";
import {
  OFFLINE_RESOURCE_TYPES,
  printNamedResourceApiResponse,
  printResourceList,
  requestResourceByIdApi,
  requireResource,
  requireTargetService,
  resolveOfflineCreateResourceType,
  resolveResourceType,
  type ResourceCapability,
  type ResourceCreateCommandOptions,
  type ResourceDeleteCommandOptions,
  type ResourceListCommandOptions,
  type ResourceListItem,
  type ResourceTargetOptions,
  VALID_RESOURCE_TYPES,
  withResolvedResource,
} from "./resource-shared.ts";

async function createOfflineResource(
  name: string,
  options: ResourceCreateCommandOptions,
  resourceType: ResourceCapability,
): Promise<void> {
  const { createResource } = await import("../lib/entities/resource.ts");
  const result = await createResource(name, {
    type: resolveOfflineCreateResourceType(resourceType),
    binding: options.binding,
    env: options.env,
    group: options.group ?? "takos",
    groupName: options.group ?? "takos",
    accountId: resolveAccountId(options.accountId),
    apiToken: resolveApiToken(options.apiToken),
  });

  if (options.json) {
    printJson(result);
    return;
  }

  const idInfo = result.id ? dim(` (${result.id})`) : "";
  console.log(
    `${green("✓")} ${result.name} [${result.type}] ${result.status}${idInfo}`,
  );
}

async function createManagedResource(
  name: string,
  options: ResourceCreateCommandOptions,
  resourceType: ResourceCapability,
): Promise<void> {
  const spaceId = resolveSpaceId(options.space);
  const group = options.group
    ? await ensureGroupInSpace(spaceId, options.group)
    : null;
  const data = await requestApiOrThrow<
    { resource: { id: string; name: string; type: string; status: string } }
  >("/api/resources", {
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
    printJson(data);
    return;
  }

  console.log(
    `${
      green("✓")
    } ${data.resource.name} [${data.resource.type}] ${data.resource.status}`,
  );
  if (group) {
    console.log(dim(`  group=${group.name}`));
  }
}

async function listOfflineResourcesCommand(
  options: ResourceListCommandOptions,
): Promise<void> {
  const { listResources } = await import("../lib/entities/resource.ts");
  const resources = await listResources(options.group);
  printResourceList(resources, {
    json: options.json,
    emptyMessage: "No resources tracked.",
    render: (resource) => {
      const idLabel = resource.id ? dim(` (${resource.id})`) : "";
      return `  ${resource.name} [${resource.type}]${idLabel}`;
    },
  });
}

async function listManagedResourcesCommand(
  options: ResourceListCommandOptions,
): Promise<void> {
  const resources = await listResourcesInSpace(resolveSpaceId(options.space));
  printResourceList(resources, {
    json: options.json,
    emptyMessage: "No resources found.",
    render: (resource: ResourceListItem) => {
      const idLabel = resource.id ? dim(` (${resource.id})`) : "";
      const groupLabel = resource.group_id
        ? dim(` group=${resource.group_id}`)
        : "";
      return `  ${resource.name} [${resource.type}]${idLabel}${groupLabel}`;
    },
  });
}

async function deleteOfflineResourceCommand(
  name: string,
  options: ResourceDeleteCommandOptions,
): Promise<void> {
  const { deleteResource } = await import("../lib/entities/resource.ts");
  await deleteResource(name, {
    group: options.group,
    accountId: resolveAccountId(options.accountId),
    apiToken: resolveApiToken(options.apiToken),
  });
  console.log(green(`Removed resource '${name}' from offline state.`));
}

async function deleteManagedResourceCommand(
  name: string,
  options: ResourceDeleteCommandOptions,
): Promise<void> {
  const resource = await requireResource(resolveSpaceId(options.space), name);
  await requestResourceByIdApi(resource.id, "", { method: "DELETE" });
  console.log(green(`Deleted resource '${name}'.`));
}

export function registerResourceLifecycleCommands(resourceCmd: Command): void {
  resourceCmd
    .command("create <name>")
    .description("Create a new resource")
    .option(
      "--type <type>",
      `Resource type (${VALID_RESOURCE_TYPES.join(", ")})`,
    )
    .option("--binding <binding>", "Suggested binding name")
    .option("--env <env>", "Target environment", "staging")
    .option("--group <name>", "Attach the resource to a group")
    .option("--space <id>", "Target workspace ID")
    .option(
      "--account-id <id>",
      "Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)",
    )
    .option(
      "--api-token <token>",
      "Cloudflare API token (or set CLOUDFLARE_API_TOKEN)",
    )
    .option("--json", "Machine-readable JSON output")
    .option("--offline", "Force local entity operations (skip API)")
    .action(
      withCommandError(
        "Failed to create resource",
        async (name: string, options: ResourceCreateCommandOptions) => {
          const resourceType = resolveResourceType({ type: options.type });
          if (options.offline) {
            if (!OFFLINE_RESOURCE_TYPES.has(resourceType)) {
              throw new Error(
                `Offline resource create does not support type: ${resourceType}`,
              );
            }
            await createOfflineResource(name, options, resourceType);
            return;
          }
          await createManagedResource(name, options, resourceType);
        },
      ),
    );

  resourceCmd
    .command("attach <name>")
    .description("Attach a resource to a group")
    .requiredOption("--group <name>", "Target group name")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        "Failed to attach resource",
        async (name: string, options: { group: string; space?: string }) => {
          const spaceId = resolveSpaceId(options.space);
          const resource = await requireResource(spaceId, name);
          const group = await ensureGroupInSpace(spaceId, options.group);
          await setResourceGroup(resource.id, group.id);
          console.log(
            green(`Attached resource '${name}' to group '${group.name}'.`),
          );
        },
      ),
    );

  resourceCmd
    .command("detach <name>")
    .description("Detach a resource from its group")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        "Failed to detach resource",
        async (name: string, options: { space?: string }) => {
          const spaceId = resolveSpaceId(options.space);
          const resource = await requireResource(spaceId, name);
          await setResourceGroup(resource.id, null);
          console.log(green(`Detached resource '${name}' from its group.`));
        },
      ),
    );

  resourceCmd
    .command("list")
    .description("List resources in a workspace")
    .option("--group <name>", "Target group for offline state", "default")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .option("--offline", "Force local entity operations (skip API)")
    .action(
      withCommandError(
        "Failed to list resources",
        async (options: ResourceListCommandOptions) => {
          if (options.offline) {
            await listOfflineResourcesCommand(options);
            return;
          }
          await listManagedResourcesCommand(options);
        },
      ),
    );

  resourceCmd
    .command("show <name>")
    .description("Show a resource")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        "Failed to show resource",
        async (name: string, options: { space?: string; json?: boolean }) => {
          await printNamedResourceApiResponse(name, options);
        },
      ),
    );

  resourceCmd
    .command("delete <name>")
    .description("Delete a resource")
    .option("--group <name>", "Target group for offline state", "default")
    .option("--space <id>", "Target workspace ID")
    .option(
      "--account-id <id>",
      "Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)",
    )
    .option(
      "--api-token <token>",
      "Cloudflare API token (or set CLOUDFLARE_API_TOKEN)",
    )
    .option("--offline", "Force local entity operations (skip API)")
    .action(
      withCommandError(
        "Failed to delete resource",
        async (name: string, options: ResourceDeleteCommandOptions) => {
          if (options.offline) {
            await deleteOfflineResourceCommand(name, options);
            return;
          }
          await deleteManagedResourceCommand(name, options);
        },
      ),
    );

  resourceCmd
    .command("bind <name>")
    .description("Bind a resource to a worker or service")
    .requiredOption(
      "--binding <binding>",
      "Binding name to expose inside the workload",
    )
    .option("--worker <name>", "Target worker slug/name")
    .option("--service <name>", "Target service slug/name")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        "Failed to bind resource",
        async (
          name: string,
          options: ResourceTargetOptions & { binding: string },
        ) => {
          await withResolvedResource(
            name,
            options,
            async ({ resource, spaceId }) => {
              const target = await requireTargetService(
                spaceId,
                options.worker,
                options.service,
              );
              await requestResourceByIdApi(resource.id, "/bind", {
                method: "POST",
                body: {
                  service_id: target.id,
                  binding_name: options.binding,
                },
              });
              console.log(
                green(
                  `Bound '${name}' to '${
                    target.slug ?? target.id
                  }' as ${options.binding}.`,
                ),
              );
            },
          );
        },
      ),
    );

  resourceCmd
    .command("unbind <name>")
    .description("Remove a resource binding from a worker or service")
    .option("--worker <name>", "Target worker slug/name")
    .option("--service <name>", "Target service slug/name")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        "Failed to unbind resource",
        async (name: string, options: ResourceTargetOptions) => {
          await withResolvedResource(
            name,
            options,
            async ({ resource, spaceId }) => {
              const target = await requireTargetService(
                spaceId,
                options.worker,
                options.service,
              );
              await requestResourceByIdApi(
                resource.id,
                `/bind/${encodeURIComponent(target.id)}`,
                { method: "DELETE" },
              );
              console.log(
                green(`Unbound '${name}' from '${target.slug ?? target.id}'.`),
              );
            },
          );
        },
      ),
    );
}
