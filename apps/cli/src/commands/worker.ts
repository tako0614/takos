/**
 * CLI command: `takos worker`
 *
 * Manage Workers as first-class workloads.
 *
 * Default (online): CRUD via the workload deployment API.
 * --offline: Delegate to the local entity operations.
 */
import type { Command } from 'commander';
import chalk from 'chalk';
import { cliExit } from '../lib/command-exit.js';
import { api } from '../lib/api.js';
import { resolveSpaceId } from '../lib/cli-utils.js';
import {
  createWorkerDeployment,
  ensureServiceInSpace,
  ensureGroupInSpace,
  findServiceInSpace,
  listServicesInSpace,
  readUtf8File,
  setServiceGroup,
} from '../lib/platform-surface.js';

export function registerWorkerCommand(program: Command): void {
  const workerCmd = program
    .command('worker')
    .description('Manage Workers as first-class workloads');

  workerCmd
    .command('deploy <name>')
    .description('Deploy a worker bundle')
    .requiredOption('--artifact <path>', 'Path to the built worker bundle')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Attach the worker to a group')
    .option('--space <id>', 'Target workspace ID')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: {
      artifact: string;
      env: string;
      group: string;
      space?: string;
      namespace?: string;
      accountId?: string;
      apiToken?: string;
      json?: boolean;
      offline?: boolean;
    }) => {
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deployWorker } = await import('../lib/entities/worker.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        if (!options.json) {
          console.log(`${chalk.cyan('[DEPLOY]')} worker ${chalk.bold(name)} -> ${options.env} (offline)`);
          console.log(`  Artifact: ${options.artifact}`);
        }

        try {
          const result = await deployWorker(name, {
            artifact: options.artifact,
            group: options.group ?? 'takos',
            env: options.env,
            groupName: options.group ?? 'takos',
            accountId,
            apiToken,
            namespace: options.namespace,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }

          if (result.success) {
            console.log(`  ${chalk.green('✓')} ${result.scriptName} deployed`);
          } else {
            console.log(`  ${chalk.red('✗')} Deploy failed`);
            if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
            cliExit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to deploy worker: ${message}`));
          cliExit(1);
        }
        return;
      }

      const spaceId = resolveSpaceId(options.space);

      if (!options.json) {
        console.log(`${chalk.cyan('[DEPLOY]')} worker ${chalk.bold(name)} -> ${options.env}`);
        console.log(`  Artifact: ${options.artifact}`);
      }

      try {
        const bundle = await readUtf8File(options.artifact);
        const group = options.group
          ? await ensureGroupInSpace(spaceId, options.group)
          : null;
        const service = await ensureServiceInSpace({
          spaceId,
          name,
          groupId: group?.id ?? null,
          serviceType: 'app',
        });
        if (group && service.group_id !== group.id) {
          await setServiceGroup(service.id, group.id);
        }
        const result = await createWorkerDeployment({
          serviceId: service.id,
          bundle,
          deployMessage: `takos worker deploy ${name}`,
        });

        if (options.json) {
          process.stdout.write(`${JSON.stringify({ service, ...result }, null, 2)}\n`);
          return;
        }

        console.log(`  ${chalk.green('✓')} deployment ${result.deployment.id} v${result.deployment.version}`);
        console.log(chalk.dim(`  status=${result.deployment.status} slug=${service.slug ?? service.id}`));
        if (group) {
          console.log(chalk.dim(`  group=${group.name}`));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to deploy worker: ${message}`));
        cliExit(1);
      }
    });

  workerCmd
    .command('attach <name>')
    .description('Attach a worker to a group')
    .requiredOption('--group <name>', 'Target group name')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { group: string; space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const service = await findServiceInSpace(spaceId, name, 'app');
        if (!service) {
          console.log(chalk.red(`Worker not found: ${name}`));
          cliExit(1);
          return;
        }
        const group = await ensureGroupInSpace(spaceId, options.group);
        await setServiceGroup(service.id, group.id);
        console.log(chalk.green(`Attached worker '${name}' to group '${group.name}'.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to attach worker: ${message}`));
        cliExit(1);
      }
    });

  workerCmd
    .command('detach <name>')
    .description('Detach a worker from its group')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const service = await findServiceInSpace(spaceId, name, 'app');
        if (!service) {
          console.log(chalk.red(`Worker not found: ${name}`));
          cliExit(1);
          return;
        }
        await setServiceGroup(service.id, null);
        console.log(chalk.green(`Detached worker '${name}' from its group.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to detach worker: ${message}`));
        cliExit(1);
      }
    });

  workerCmd
    .command('list')
    .description('List workers in a workspace')
    .option('--group <name>', 'Target group for offline state', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (options: { group: string; space?: string; json?: boolean; offline?: boolean }) => {
      if (options.offline) {
        const { listWorkers } = await import('../lib/entities/worker.js');
        try {
          const workers = await listWorkers(options.group);
          if (options.json) {
            process.stdout.write(`${JSON.stringify(workers, null, 2)}\n`);
            return;
          }
          if (workers.length === 0) {
            console.log(chalk.dim('No workers tracked. Use `takos worker deploy` to deploy one.'));
            return;
          }
          console.log('');
          console.log(chalk.bold('Workers:'));
          for (const worker of workers) {
            const scriptLabel = chalk.dim(` -> ${worker.scriptName}`);
            const hashLabel = worker.codeHash ? chalk.dim(` [${worker.codeHash}]`) : '';
            console.log(`  ${worker.name}${scriptLabel}${hashLabel}`);
          }
          console.log('');
          console.log(chalk.dim(`${workers.length} worker(s)`));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to list workers: ${message}`));
          cliExit(1);
        }
        return;
      }

      try {
        const spaceId = resolveSpaceId(options.space);
        const workers = (await listServicesInSpace(spaceId))
          .filter((service) => service.service_type === 'app');

        if (options.json) {
          process.stdout.write(`${JSON.stringify(workers, null, 2)}\n`);
          return;
        }

        if (workers.length === 0) {
          console.log(chalk.dim('No workers found.'));
          return;
        }

        console.log('');
        console.log(chalk.bold('Workers:'));
        for (const worker of workers) {
          const slugLabel = worker.slug ? chalk.dim(` slug=${worker.slug}`) : '';
          const hostnameLabel = worker.hostname ? chalk.dim(` host=${worker.hostname}`) : '';
          const groupLabel = worker.group_id ? chalk.dim(` group=${worker.group_id}`) : '';
          console.log(`  ${worker.id}${slugLabel}${hostnameLabel}${groupLabel}`);
        }
        console.log('');
        console.log(chalk.dim(`${workers.length} worker(s)`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to list workers: ${message}`));
        cliExit(1);
      }
    });

  workerCmd
    .command('delete <name>')
    .description('Delete a worker workload')
    .option('--group <name>', 'Target group for offline state', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: { group: string; space?: string; accountId?: string; apiToken?: string; offline?: boolean }) => {
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deleteWorker } = await import('../lib/entities/worker.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);
        try {
          await deleteWorker(name, { group: options.group, accountId, apiToken });
          console.log(chalk.green(`Removed worker '${name}' from offline state.`));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to delete worker: ${message}`));
          cliExit(1);
        }
        return;
      }

      try {
        const spaceId = resolveSpaceId(options.space);
        const service = await findServiceInSpace(spaceId, name, 'app');
        if (!service) {
          console.log(chalk.red(`Worker not found: ${name}`));
          cliExit(1);
          return;
        }

        const res = await api<void>(`/api/services/${encodeURIComponent(service.id)}`, { method: 'DELETE' });
        if (!res.ok) {
          console.log(chalk.red(`Error: ${res.error}`));
          cliExit(1);
        }

        console.log(chalk.green(`Deleted worker '${name}'.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to delete worker: ${message}`));
        cliExit(1);
      }
    });
}
