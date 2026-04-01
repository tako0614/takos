/**
 * `takos group delete` subcommand.
 */
import type { Command } from 'commander';
import { bold, dim, green, red } from '@std/fmt/colors';
import { readState, getStateDir, deleteStateFile } from '../../lib/state/state-file.ts';
import { cliExit } from '../../lib/command-exit.ts';
import { api } from '../../lib/api.ts';
import { confirmPrompt } from '../../lib/cli-utils.ts';
import { validateGroupName, toAccessOpts, requireApiGroupByName, resolveGroupSpaceId } from './helpers.ts';

export function registerGroupDeleteCommand(groupCmd: Command): void {
  groupCmd
    .command('delete <name>')
    .description('Delete a group and its state')
    .option('--force', 'Skip confirmation prompt')
    .option('--space <id>', 'Target workspace ID')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (name: string, options: { force?: boolean; offline?: boolean; space?: string }) => {
      validateGroupName(name);

      if (!options.offline) {
        const spaceId = resolveGroupSpaceId(options.space);

        try {
          const group = await requireApiGroupByName(spaceId, name);

          if (!options.force) {
            console.log('');
            console.log(bold(`Group: ${name}`));
            console.log(dim('  Empty groups only. Delete fails if resources/services are still attached.'));
            console.log('');

            const confirmed = await confirmPrompt(bold(red('Delete this group?')));
            if (!confirmed) {
              console.log(dim('Cancelled.'));
              return;
            }
          }

          const res = await api<{ deleted: boolean }>(`/api/spaces/${spaceId}/groups/${group.id}`, {
            method: 'DELETE',
          });
          if (!res.ok) {
            throw new Error(res.error);
          }

          console.log(green(`Deleted group '${name}'`));
          return;
        } catch (error) {
          console.log(red(error instanceof Error ? error.message : String(error)));
          cliExit(1);
          return;
        }
      }

      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      const state = await readState(stateDir, name, accessOpts);

      if (!state) {
        console.log(red(`Group not found: ${name}`));
        console.log(dim('Use `takos group list` to see available groups.'));
        cliExit(1);
        return; // unreachable
      }

      const resourceCount = Object.keys(state.resources || {}).length;
      const workerCount = Object.keys(state.workers || {}).length;
      const containerCount = Object.keys(state.containers || {}).length;
      const serviceCount = Object.keys(state.services || {}).length;
      const totalCount = resourceCount + workerCount + containerCount + serviceCount;

      if (!options.force) {
        console.log('');
        console.log(bold(`Group: ${name}`));
        console.log(`  ${totalCount} entit${totalCount === 1 ? 'y' : 'ies'} will be removed from state.`);
        console.log(dim('  (Actual cloud resources will NOT be deleted.)'));
        console.log('');

        const confirmed = await confirmPrompt(bold(red('Delete this group?')));
        if (!confirmed) {
          console.log(dim('Cancelled.'));
          return;
        }
      }

      await deleteStateFile(stateDir, name, accessOpts);
      console.log(green(`Deleted group '${name}'`));
      console.log(dim('Actual cloud resources were NOT deleted.'));
    });
}
