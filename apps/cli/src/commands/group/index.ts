/**
 * CLI command: `takos group`
 *
 * Manage groups (state namespaces).
 *
 * By default state is fetched from the takos API.  When the API is
 * unavailable or `--offline` is passed, the local file backend
 * (.takos/state.*.json) is used instead.
 *
 * Subcommands:
 *   takos group list              -- List groups
 *   takos group show <name>       -- Show all entities in a group
 *   takos group delete <name>     -- Delete all entities and state for a group
 */
import { Command } from 'commander';
import { registerGroupListCommand } from './list.js';
import { registerGroupShowCommand } from './show.js';
import { registerGroupDeleteCommand } from './delete.js';
import { registerGroupDesiredCommand } from './desired.js';

export function registerGroupCommand(program: Command): void {
  const groupCmd = program
    .command('group')
    .description('Manage groups (state namespaces)');

  registerGroupListCommand(groupCmd);
  registerGroupShowCommand(groupCmd);
  registerGroupDeleteCommand(groupCmd);
  registerGroupDesiredCommand(groupCmd);
}
