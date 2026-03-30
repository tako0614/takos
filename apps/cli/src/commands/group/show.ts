/**
 * `takos group show` subcommand.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readState, getStateDir } from '../../lib/state/state-file.js';
import { cliExit } from '../../lib/command-exit.js';
import { api } from '../../lib/api.js';
import { validateGroupName, toAccessOpts, requireApiGroupByName, resolveGroupSpaceId } from './helpers.js';

type ApiInventoryItem = Record<string, unknown>;
type GroupDetailResponse = {
  inventory: {
    resources: ApiInventoryItem[];
    workloads: ApiInventoryItem[];
    routes: ApiInventoryItem[];
  };
  provider?: string | null;
  env?: string | null;
  observed?: {
    groupName?: string;
    updatedAt?: string;
  } | null;
};

export function registerGroupShowCommand(groupCmd: Command): void {
  groupCmd
    .command('show <name>')
    .description('Show all entities in a group')
    .option('--json', 'Machine-readable JSON output')
    .option('--space <id>', 'Target workspace ID')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (name: string, options: { json?: boolean; offline?: boolean; space?: string }) => {
      validateGroupName(name);
      const spaceId = resolveGroupSpaceId(options.space);

      if (!options.offline) {
        try {
          const group = await requireApiGroupByName(spaceId, name);
          const res = await api<GroupDetailResponse>(`/api/spaces/${spaceId}/groups/${group.id}`);
          if (!res.ok) {
            throw new Error(res.error);
          }

          const data = res.data;
          const inventory = data.inventory ?? { resources: [], workloads: [], routes: [] };
          const observed = data.observed ?? {};

          if (options.json) {
            process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
            return;
          }

          console.log('');
          console.log(chalk.bold(`Group: ${name}`));
          console.log(`  Provider:    ${data.provider || '(unknown)'}`);
          console.log(`  Environment: ${data.env || '(unknown)'}`);
          console.log(`  Group name:  ${observed.groupName || name}`);
          console.log(`  Updated at:  ${observed.updatedAt || '(never)'}`);
          console.log('');

          const resources = inventory.resources ?? [];
          const workloads = inventory.workloads ?? [];
          const routes = inventory.routes ?? [];

          if (resources.length > 0) {
            console.log(chalk.bold('Resources:'));
            for (const resource of resources) {
              const resourceName = String(resource.name ?? '(unnamed)');
              const typeLabel = resource.manifestType ? `[${String(resource.manifestType)}]` : '';
              const idLabel = resource.resourceId ? chalk.dim(` (${String(resource.resourceId)})`) : '';
              console.log(`  resources.${resourceName} ${typeLabel}${idLabel}`);
            }
            console.log('');
          }

          if (workloads.length > 0) {
            console.log(chalk.bold('Workloads:'));
            for (const workload of workloads) {
              const workloadName = String(workload.name ?? '(unnamed)');
              const sourceKind = String(workload.sourceKind ?? 'service');
              const hostLabel = workload.hostname ? chalk.dim(` -> ${String(workload.hostname)}`) : '';
              console.log(`  ${sourceKind}s.${workloadName} [${sourceKind}]${hostLabel}`);
            }
            console.log('');
          }

          if (routes.length > 0) {
            console.log(chalk.bold('Routes:'));
            for (const route of routes) {
              const routeName = String(route.name ?? '(unnamed)');
              const target = String(route.target ?? '(unknown)');
              const urlLabel = route.url ? chalk.dim(` url=${String(route.url)}`) : '';
              console.log(`  routes.${routeName} -> ${target}${urlLabel}`);
            }
            console.log('');
          }

          const totalCount = resources.length + workloads.length + routes.length;
          if (totalCount === 0) {
            console.log(chalk.dim('Group is empty.'));
          }

          console.log(chalk.dim(
            `${resources.length} resource(s), ${workloads.length} workload(s), ${routes.length} route(s)`,
          ));
          return;
        } catch (error) {
          console.log(chalk.red(error instanceof Error ? error.message : String(error)));
          cliExit(1);
          return;
        }
      }

      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      const state = await readState(stateDir, name, accessOpts);

      if (!state) {
        console.log(chalk.red(`Group not found: ${name}`));
        console.log(chalk.dim('Use `takos group list` to see available groups.'));
        cliExit(1);
        return; // unreachable
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
        return;
      }

      console.log('');
      console.log(chalk.bold(`Group: ${name}`));
      console.log(`  Provider:    ${state.provider || '(unknown)'}`);
      console.log(`  Environment: ${state.env || '(unknown)'}`);
      console.log(`  Group name:  ${state.groupName || '(unknown)'}`);
      console.log(`  Updated at:  ${state.updatedAt || '(never)'}`);
      console.log('');

      const resources = state.resources || {};
      const workers = state.workers || {};
      const containers = state.containers || {};
      const services = state.services || {};
      const routes = state.routes || {};

      const resourceKeys = Object.keys(resources);
      const workerKeys = Object.keys(workers);
      const containerKeys = Object.keys(containers);
      const serviceKeys = Object.keys(services);
      const routeKeys = Object.keys(routes);

      if (resourceKeys.length > 0) {
        console.log(chalk.bold('Resources:'));
        for (const resourceName of resourceKeys) {
          const resource = resources[resourceName];
          const typeLabel = resource.type ? `[${resource.type}]` : '';
          const idLabel = resource.id ? chalk.dim(` (${resource.id})`) : '';
          console.log(`  resources.${resourceName} ${typeLabel}${idLabel}`);
        }
        console.log('');
      }

      if (workerKeys.length > 0) {
        console.log(chalk.bold('Workers:'));
        for (const workerName of workerKeys) {
          const worker = workers[workerName];
          const scriptLabel = worker.scriptName ? chalk.dim(` -> ${worker.scriptName}`) : '';
          console.log(`  workers.${workerName} [worker]${scriptLabel}`);
        }
        console.log('');
      }

      if (containerKeys.length > 0) {
        console.log(chalk.bold('Containers:'));
        for (const containerName of containerKeys) {
          console.log(`  containers.${containerName} [container]`);
        }
        console.log('');
      }

      if (serviceKeys.length > 0) {
        console.log(chalk.bold('Services:'));
        for (const serviceName of serviceKeys) {
          const service = services[serviceName];
          const ipLabel = service.ipv4 ? chalk.dim(` (${service.ipv4})`) : '';
          console.log(`  services.${serviceName} [service]${ipLabel}`);
        }
        console.log('');
      }

      if (routeKeys.length > 0) {
        console.log(chalk.bold('Routes:'));
        for (const routeName of routeKeys) {
          const route = routes[routeName];
          const domainLabel = route.domain ? chalk.dim(` domain=${route.domain}`) : '';
          const urlLabel = route.url ? chalk.dim(` url=${route.url}`) : '';
          console.log(`  routes.${routeName} -> ${route.target}${domainLabel}${urlLabel}`);
        }
        console.log('');
      }

      const totalCount = resourceKeys.length + workerKeys.length + containerKeys.length + serviceKeys.length + routeKeys.length;
      if (totalCount === 0) {
        console.log(chalk.dim('Group is empty.'));
      }

      console.log(chalk.dim(
        `${resourceKeys.length} resource(s), ${workerKeys.length} worker(s), ` +
        `${containerKeys.length} container(s), ${serviceKeys.length} service(s), ` +
        `${routeKeys.length} route(s)`,
      ));
    });
}
