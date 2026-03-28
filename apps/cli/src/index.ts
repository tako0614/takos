#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { registerLoginCommand } from './commands/login.js';
import { registerDeployCommand } from './commands/deploy.js';
import { registerTaskCommands } from './commands/api.js';
import { registerEndpointCommand } from './commands/endpoint.js';
import { registerDeployGroupCommand } from './commands/deploy-group.js';
import { registerPlanCommand } from './commands/plan.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerStateCommand } from './commands/state.js';
import { registerWorkerCommand } from './commands/worker.js';
import { registerResourceCommand } from './commands/resource.js';
import { registerContainerCommand } from './commands/container.js';
import { registerServiceCommand } from './commands/service.js';
import { isContainerMode, isAuthenticated } from './lib/config.js';
import { cliExit, isCliCommandExit } from './lib/command-exit.js';

const program = new Command();

program
  .name('takos')
  .description('Unified task-oriented CLI for Takos platform')
  .version('0.2.0');

registerLoginCommand(program);
registerDeployCommand(program);
registerDeployGroupCommand(program);
registerPlanCommand(program);
registerApplyCommand(program);
registerStateCommand(program);
registerWorkerCommand(program);
registerResourceCommand(program);
registerContainerCommand(program);
registerServiceCommand(program);
registerEndpointCommand(program);
registerTaskCommands(program);

program.hook('preAction', (thisCommand) => {
  const commandName = (typeof process.argv[2] === 'string' && process.argv[2].trim().length > 0)
    ? process.argv[2].trim().toLowerCase()
    : thisCommand.name().toLowerCase();

  if (['login', 'logout', 'help', 'endpoint', 'deploy-group', 'plan', 'apply', 'state', 'worker', 'resource', 'container', 'service'].includes(commandName)) {
    return;
  }

  if (isContainerMode()) {
    return;
  }

  if (!isAuthenticated()) {
    console.log(chalk.red('Not authenticated. Run `takos login` first.'));
    cliExit(1);
  }
});

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (isCliCommandExit(error)) {
      process.exit(error.code);
    }
    throw error;
  }
}

void main();
