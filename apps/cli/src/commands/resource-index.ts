/**
 * CLI command: `takos resource` (and `takos res` alias).
 *
 * Owns the entire resource command tree. The generic task-domain CRUD for
 * `resource` was removed from registerTaskCommands (commands/api.ts) because
 * its subcommand names (list/create/...) collided with the canonical
 * resource subcommands defined in resource-management-commands.ts and
 * resource-store-commands.ts.
 *
 * Subcommand layout:
 *
 *   takos resource create <name>          (resource-management-commands.ts)
 *   takos resource list                   (resource-management-commands.ts)
 *   takos resource show <name>            (resource-management-commands.ts)
 *   takos resource delete <name>          (resource-management-commands.ts)
 *   takos resource bind <name>            (resource-management-commands.ts)
 *   takos resource unbind <name>          (resource-management-commands.ts)
 *   takos resource attach <name>          (resource-management-commands.ts)
 *   takos resource detach <name>          (resource-management-commands.ts)
 *
 *   takos resource sql tables|query       (resource-store-commands.ts)
 *   takos resource object ls|get|put|rm   (resource-store-commands.ts)
 *   takos resource kv     ls|get|put|rm   (resource-store-commands.ts)
 *
 *   takos resource get-secret <name>      (resource-core.ts)
 *   takos resource rotate-secret <name>   (resource-core.ts)
 */
import type { Command } from "commander";
import { registerResourceSecretCommands } from "./resource-core.ts";
import {
  registerBindingCommands,
  registerCreateCommand,
  registerGroupAttachmentCommands,
  registerListShowDeleteCommands,
} from "./resource-management-commands.ts";
import {
  registerKvCommands,
  registerObjectCommands,
  registerSqlCommands,
} from "./resource-store-commands.ts";

export function registerResourceCommands(program: Command): void {
  const resourceCmd = program
    .command("resource")
    .alias("res")
    .description("Manage resources (storage, secrets, bindings)");

  // Lifecycle: create / list / show / delete
  registerCreateCommand(resourceCmd);
  registerListShowDeleteCommands(resourceCmd);

  // Workload bindings: bind / unbind
  registerBindingCommands(resourceCmd);

  // Group membership: attach / detach
  registerGroupAttachmentCommands(resourceCmd);

  // Storage data plane: sql / object / kv
  registerSqlCommands(resourceCmd);
  registerObjectCommands(resourceCmd);
  registerKvCommands(resourceCmd);

  // Secret resources: get-secret / rotate-secret
  registerResourceSecretCommands(resourceCmd);
}
