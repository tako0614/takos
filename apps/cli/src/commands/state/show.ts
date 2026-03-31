import { Command } from 'commander';
import { bold, dim, red } from '@std/fmt/colors';
import { readState, getStateDir } from '../../lib/state/state-file.ts';
import { cliExit } from '../../lib/command-exit.ts';
import { printJson } from '../../lib/cli-utils.ts';
import type { TakosState } from '../../lib/state/state-types.ts';
import { resolveStateKey, toAccessOpts } from './helpers.ts';

export function registerStateShowCommand(stateCmd: Command): void {
  stateCmd
    .command('show <key>')
    .description('Show details for a specific resource or service (e.g. resources.db)')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (key: string, options: { group: string; json?: boolean; offline?: boolean }) => {
      const group = options.group;
      const stateDir = getStateDir(process.cwd());
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(red('No state found. Run `takos apply` first.'));
        cliExit(1);
        return; // unreachable, helps TS narrow
      }

      const resolved = resolveStateKey(state, key);
      if (!resolved) {
        console.log(red(`Not found in state: ${key}`));
        console.log(dim('Use `takos state list` to see available entries.'));
        cliExit(1);
      }

      if (options.json) {
        printJson({ category: resolved.category, name: resolved.name, ...resolved.entry });
        return;
      }

      console.log('');
      console.log(bold(`${resolved.category}.${resolved.name}`));
      for (const [field, value] of Object.entries(resolved.entry)) {
        if (value !== undefined && value !== null) {
          console.log(`  ${field}: ${value}`);
        }
      }
      console.log('');
    });
}
