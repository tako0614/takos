import { Command } from 'commander';
import { green, red } from '@std/fmt/colors';
import { readState, writeState, getStateDir } from '../../lib/state/state-file.ts';
import { cliExit } from '../../lib/command-exit.ts';
import type { TakosState } from '../../lib/state/state-types.ts';
import { toAccessOpts } from './helpers.ts';

export function registerStateImportCommand(stateCmd: Command): void {
  stateCmd
    .command('import <key> <id>')
    .description('Import an existing resource into state (e.g. state import resources.db abc123)')
    .option('--group <name>', 'Group name', 'default')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (key: string, id: string, options: { group: string; offline?: boolean }) => {
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

      const now = new Date().toISOString();
      if (!state) {
        state = {
          version: 1,
          provider: 'cloudflare',
          env: 'unknown',
          group,
          groupName: 'unknown',
          updatedAt: now,
          resources: {},
          workers: {},
          containers: {},
          services: {},
          routes: {},
        };
      }

      const parts = key.split('.');
      if (parts.length !== 2) {
        console.log(red('Key must be in the format "category.name" (e.g. resources.db)'));
        cliExit(1);
      }

      const [category, name] = parts;
      if (category === 'resources') {
        state.resources[name] = {
          type: 'unknown',
          id,
          binding: name,
          createdAt: now,
        };
      } else if (category === 'workers') {
        state.workers[name] = {
          scriptName: id,
          deployedAt: now,
          codeHash: '',
        };
      } else if (category === 'containers') {
        state.containers[name] = {
          deployedAt: now,
          imageHash: '',
        };
      } else if (category === 'services') {
        state.services[name] = {
          deployedAt: now,
          imageHash: '',
        };
      } else {
        console.log(red(`Unknown category: ${category}. Use "resources", "workers", "containers", or "services".`));
        cliExit(1);
      }

      state.updatedAt = now;
      await writeState(stateDir, group, state, accessOpts);
      console.log(green(`Imported ${key} with id ${id}`));
    });
}
