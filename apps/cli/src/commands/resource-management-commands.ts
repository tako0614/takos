import type { Command } from "commander";
import { green } from "@std/fmt/colors";
import { fail, withCommandError } from "./resource-helpers.ts";
import {
  attachResourceToGroup,
  createOfflineResource,
  createOnlineResource,
  deleteOfflineResourceForCommand,
  deleteOnlineResourceForCommand,
  detachResourceFromGroup,
  listOfflineResourcesForCommand,
  listOnlineResourcesForCommand,
  printNamedResourceApiResponse,
  printResourceList,
  requestResourceByIdApi,
  resolveResourceType,
  type ResourceCreateCommandOptions,
  type ResourceDeleteCommandOptions,
  type ResourceJsonCommandOptions,
  type ResourceListCommandOptions,
  type ResourceTargetOptions,
  VALID_RESOURCE_TYPES,
  withResolvedBindingTarget,
} from "./resource-core.ts";

export function registerCreateCommand(resourceCmd: Command) {
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
    .action(async (name: string, options: ResourceCreateCommandOptions) => {
      let resourceType;
      try {
        resourceType = resolveResourceType({ type: options.type });
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }

      const runCreate = options.offline
        ? createOfflineResource
        : createOnlineResource;
      await withCommandError("Failed to create resource", async () => {
        await runCreate(name, resourceType, options);
      })();
    });
}

export function registerGroupAttachmentCommands(resourceCmd: Command) {
  resourceCmd
    .command("attach <name>")
    .description("Attach a resource to a group")
    .requiredOption("--group <name>", "Target group name")
    .option("--space <id>", "Target workspace ID")
    .action(
      withCommandError(
        "Failed to attach resource",
        async (name: string, options: { group: string; space?: string }) => {
          await attachResourceToGroup(name, options);
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
          await detachResourceFromGroup(name, options);
        },
      ),
    );
}

export function registerListShowDeleteCommands(resourceCmd: Command) {
  resourceCmd
    .command("list")
    .description("List resources in a workspace")
    .option("--group <name>", "Target group for offline state", "default")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .option("--offline", "Force local entity operations (skip API)")
    .action(async (options: ResourceListCommandOptions) => {
      const listResources = options.offline
        ? listOfflineResourcesForCommand
        : listOnlineResourcesForCommand;
      const emptyMessage = options.offline
        ? "No resources tracked."
        : "No resources found.";

      await withCommandError("Failed to list resources", async () => {
        const resources = await listResources(options);
        printResourceList(resources, emptyMessage, options.json);
      })();
    });

  resourceCmd
    .command("show <name>")
    .description("Show a resource")
    .option("--space <id>", "Target workspace ID")
    .option("--json", "Machine-readable JSON output")
    .action(
      withCommandError(
        "Failed to show resource",
        async (name: string, options: ResourceJsonCommandOptions) => {
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
    .action(async (name: string, options: ResourceDeleteCommandOptions) => {
      const runDelete = options.offline
        ? deleteOfflineResourceForCommand
        : deleteOnlineResourceForCommand;
      await withCommandError("Failed to delete resource", async () => {
        await runDelete(name, options);
      })();
    });
}

export function registerBindingCommands(resourceCmd: Command) {
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
          await withResolvedBindingTarget(name, options, async ({
            resource,
            target,
          }) => {
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
          });
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
          await withResolvedBindingTarget(name, options, async ({
            resource,
            target,
          }) => {
            await requestResourceByIdApi(
              resource.id,
              `/bind/${encodeURIComponent(target.id)}`,
              { method: "DELETE" },
            );
            console.log(
              green(`Unbound '${name}' from '${target.slug ?? target.id}'.`),
            );
          });
        },
      ),
    );
}
