/**
 * CLI command: `takos state`
 *
 * Manage group state (API-backed with file fallback).
 *
 * By default state is fetched from the takos API.  When the API is
 * unavailable or `--offline` is passed, the local file backend
 * (.takos/state.{group}.json) is used instead.
 *
 * Subcommands:
 *   takos state list                      -- Show all tracked resources/services
 *   takos state show <key>                -- Show details for a specific entry
 *   takos state import <key> <id>         -- Import an existing resource into state
 *   takos state rm <key>                  -- Remove entry from state (does NOT delete the actual resource)
 *   takos state refresh                   -- Verify live resources where possible and remove confirmed orphans
 *   takos state sync                      -- Synchronise local and remote state
 */
import { Command } from 'commander';
import { registerStateListCommand } from './list.ts';
import { registerStateShowCommand } from './show.ts';
import { registerStateImportCommand } from './import.ts';
import { registerStateRmCommand } from './rm.ts';
import { registerStateRefreshCommand } from './refresh.ts';
import { registerStateSyncCommand } from './sync.ts';

export function registerStateCommand(program: Command): void {
  const stateCmd = program
    .command('state')
    .description('Manage state (API-backed with file fallback)');

  registerStateListCommand(stateCmd);
  registerStateShowCommand(stateCmd);
  registerStateImportCommand(stateCmd);
  registerStateRmCommand(stateCmd);
  registerStateRefreshCommand(stateCmd);
  registerStateSyncCommand(stateCmd);
}
