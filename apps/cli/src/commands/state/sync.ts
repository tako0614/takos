import { Command } from 'commander';
import chalk from 'chalk';
import { getStateDir } from '../../lib/state/state-file.js';
import { syncState } from '../../lib/state/sync.js';
import { printJson } from '../../lib/cli-utils.js';

export function registerStateSyncCommand(stateCmd: Command): void {
  stateCmd
    .command('sync')
    .description('Synchronise local file state with remote API state')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .action(async (options: { group: string; json?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);

      const result = await syncState(stateDir, group);

      if (options.json) {
        printJson(result);
        return;
      }

      switch (result.action) {
        case 'no-api':
          console.log(chalk.dim(result.message));
          break;
        case 'already-in-sync':
          console.log(chalk.green(result.message));
          break;
        case 'local-updated':
          console.log(chalk.cyan(result.message));
          break;
        case 'remote-updated':
          console.log(chalk.cyan(result.message));
          break;
        case 'no-remote':
          console.log(chalk.yellow(result.message));
          break;
        case 'no-local':
          console.log(chalk.yellow(result.message));
          break;
        default:
          console.log(result.message);
      }
    });
}
