import { Command } from 'commander';
import { bold, dim } from '@std/fmt/colors';
import { readState, getStateDir, getStateFilePath } from '../../lib/state/state-file.ts';
import { printJson } from '../../lib/cli-utils.ts';
import type { TakosState } from '../../lib/state/state-types.ts';
import { toAccessOpts } from './helpers.ts';

export function registerStateListCommand(stateCmd: Command): void {
  stateCmd
    .command('list')
    .description('List all tracked resources and services')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: { group: string; json?: boolean; offline?: boolean }) => {
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
        console.log(dim('No state found. Run `takos apply` first.'));
        return;
      }

      if (options.json) {
        printJson(state);
        return;
      }

      console.log('');
      console.log(bold(`State: ${state.groupName || '(unknown)'}`));
      console.log(`  Provider:    ${state.provider || '(unknown)'}`);
      console.log(`  Environment: ${state.env || '(unknown)'}`);
      console.log(`  Version:     ${state.version || '(unknown)'}`);
      console.log(`  Updated at:  ${state.updatedAt || '(never)'}`);
      if (accessOpts.offline) {
        const stateFilePath = getStateFilePath(stateDir, group);
        console.log(`  State file:  ${stateFilePath}`);
      }
      console.log('');

      const resources = state.resources || {};
      const workers = state.workers || {};
      const containers = state.containers || {};
      const services = state.services || {};
      const resourceKeys = Object.keys(resources);
      const workerKeys = Object.keys(workers);
      const containerKeys = Object.keys(containers);
      const serviceKeys = Object.keys(services);

      if (resourceKeys.length > 0) {
        console.log(bold('Resources:'));
        for (const name of resourceKeys) {
          const resource = resources[name];
          const typeLabel = resource.type ? `[${resource.type}]` : '';
          const idLabel = resource.id ? dim(` (${resource.id})`) : '';
          console.log(`  resources.${name} ${typeLabel}${idLabel}`);
        }
        console.log('');
      }

      if (workerKeys.length > 0) {
        console.log(bold('Workers:'));
        for (const name of workerKeys) {
          const worker = workers[name];
          const scriptLabel = worker.scriptName ? dim(` -> ${worker.scriptName}`) : '';
          console.log(`  workers.${name} [worker]${scriptLabel}`);
        }
        console.log('');
      }

      if (containerKeys.length > 0) {
        console.log(bold('Containers:'));
        for (const name of containerKeys) {
          console.log(`  containers.${name} [container]`);
        }
        console.log('');
      }

      if (serviceKeys.length > 0) {
        console.log(bold('Services:'));
        for (const name of serviceKeys) {
          const service = services[name];
          const ipLabel = service.ipv4 ? dim(` (${service.ipv4})`) : '';
          console.log(`  services.${name} [service]${ipLabel}`);
        }
        console.log('');
      }

      const totalCount = resourceKeys.length + workerKeys.length + containerKeys.length + serviceKeys.length;
      if (totalCount === 0) {
        console.log(dim('State is empty.'));
      }

      console.log(dim(`${resourceKeys.length} resource(s), ${workerKeys.length} worker(s), ${containerKeys.length} container(s), ${serviceKeys.length} service(s)`));
    });
}
