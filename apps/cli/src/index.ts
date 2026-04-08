#!/usr/bin/env node

import { Command } from "commander";
import { red } from "@std/fmt/colors";
import { registerLoginCommand } from "./commands/login.ts";
import { registerTaskCommands } from "./commands/api.ts";
import { registerEndpointCommand } from "./commands/endpoint.ts";
import { registerDeployCommand } from "./commands/deploy.ts";
import { registerInstallCommand } from "./commands/install.ts";
import { registerUninstallCommand } from "./commands/uninstall.ts";
import { registerGroupCommand } from "./commands/group/index.ts";
import { registerResourceCommands } from "./commands/resource-index.ts";
import { isAuthenticated, isContainerMode } from "./lib/config.ts";
import { cliExit, isCliCommandExit } from "./lib/command-exit.ts";

const program = new Command();

program
  .name("takos")
  .description("Unified task-oriented CLI for Takos platform")
  .version("0.2.0");

registerLoginCommand(program);
registerDeployCommand(program);
registerInstallCommand(program);
registerUninstallCommand(program);
registerGroupCommand(program);
registerEndpointCommand(program);
registerTaskCommands(program);
registerResourceCommands(program);

program.hook("preAction", (thisCommand) => {
  const commandName =
    (typeof process.argv[2] === "string" && process.argv[2].trim().length > 0)
      ? process.argv[2].trim().toLowerCase()
      : thisCommand.name().toLowerCase();

  if (
    [
      "login",
      "logout",
      "help",
      "endpoint",
      "deploy",
      "rollback",
      "install",
      "uninstall",
      "group",
    ].includes(commandName)
  ) {
    return;
  }

  if (isContainerMode()) {
    return;
  }

  if (!isAuthenticated()) {
    console.log(red("Not authenticated. Run `takos login` first."));
    cliExit(1);
  }
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (isCliCommandExit(error)) {
      Deno.exit(error.code);
    }
    throw error;
  }
}

void main();
