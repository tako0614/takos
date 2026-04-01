/**
 * `takos group list` subcommand.
 */
import type { Command } from 'commander';
import { bold, dim } from '@std/fmt/colors';
import {
  getStateDir,
  getStateFilePath,
  listStateGroups,
} from '../../lib/state/state-file.ts';
import { listApiGroups, resolveGroupSpaceId, toAccessOpts } from './helpers.ts';

export function registerGroupListCommand(groupCmd: Command): void {
  groupCmd
    .command('list')
    .description('List all groups')
    .option('--json', 'Machine-readable JSON output')
    .option('--space <id>', 'Target workspace ID')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: { json?: boolean; offline?: boolean; space?: string }) => {
      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      const groups = options.offline
        ? await listStateGroups(stateDir, accessOpts)
        : (await listApiGroups(resolveGroupSpaceId(options.space))).map((group) => group.name);

      if (options.json) {
        process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`);
        return;
      }

      if (groups.length === 0) {
        console.log(dim('No groups found. Run `takos apply` to create one.'));
        return;
      }

      console.log('');
      console.log(bold('Groups:'));
      for (const name of groups) {
        if (accessOpts.offline) {
          const stateFilePath = getStateFilePath(stateDir, name);
          console.log(`  ${name}  ${dim(stateFilePath)}`);
        } else {
          console.log(`  ${name}`);
        }
      }
      console.log('');
      console.log(dim(`${groups.length} group(s)`));
    });
}
