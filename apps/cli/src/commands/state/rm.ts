import { Command } from 'commander';
import chalk from 'chalk';
import { readState, writeState, getStateDir } from '../../lib/state/state-file.js';
import { cliExit } from '../../lib/command-exit.js';
import type { TakosState } from '../../lib/state/state-types.js';
import { resolveStateKey, toAccessOpts } from './helpers.js';

export function registerStateRmCommand(stateCmd: Command): void {
  stateCmd
    .command('rm <key>')
    .description('Remove an entry from state (does NOT delete the actual resource)')
    .option('--group <name>', 'Group name', 'default')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (key: string, options: { group: string; offline?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.red('No state found. Nothing to remove.'));
        cliExit(1);
        return; // unreachable, helps TS narrow
      }

      const resolved = resolveStateKey(state, key);
      if (!resolved) {
        console.log(chalk.red(`Not found in state: ${key}`));
        console.log(chalk.dim('Use `takos state list` to see available entries.'));
        cliExit(1);
        return; // unreachable, helps TS narrow
      }

      if (resolved.category === 'resources') {
        delete state.resources[resolved.name];
      } else if (resolved.category === 'workers') {
        delete state.workers[resolved.name];
      } else if (resolved.category === 'containers') {
        delete state.containers[resolved.name];
      } else if (resolved.category === 'services') {
        delete state.services[resolved.name];
      } else if (resolved.category === 'routes') {
        delete state.routes[resolved.name];
      }

      await writeState(stateDir, group, state, accessOpts);
      console.log(chalk.green(`Removed ${resolved.category}.${resolved.name} from state`));
      console.log(chalk.dim('The actual resource was NOT deleted. Use provider tools to delete it.'));
    });
}
