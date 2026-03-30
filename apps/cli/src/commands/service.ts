/**
 * CLI command: `takos service`
 *
 * Manage OCI-backed services as first-class workloads.
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
  createServiceDeployment,
  ensureServiceInSpace,
  ensureGroupInSpace,
  findServiceInSpace,
  listServicesInSpace,
  setServiceGroup,
} from '../lib/platform-surface.js';

export function registerServiceCommand(program: Command): void {
  const serviceCmd = program
    .command('service')
    .description('Manage persistent services (OCI workloads)');

  serviceCmd
    .command('deploy <name>')
    .description('Deploy a service image')
    .option('--dockerfile <path>', 'Path to the Dockerfile (offline mode only)')
    .requiredOption('--port <number>', 'Service port', parseInt)
    .option('--image-ref <ref>', 'Container image reference for online deploys')
    .option('--provider <name>', 'Deployment provider (oci, ecs, cloud-run, k8s)', 'oci')
    .option('--health-path <path>', 'Container health path')
    .option('--ipv4', 'Request a dedicated IPv4 address')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Attach the service to a group')
    .option('--space <id>', 'Target workspace ID')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--instance-type <type>', 'Instance type', 'basic')
    .option('--max-instances <n>', 'Maximum instances', parseInt)
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: {
      dockerfile?: string;
      port: number;
      imageRef?: string;
      provider: 'oci' | 'ecs' | 'cloud-run' | 'k8s';
      healthPath?: string;
      ipv4?: boolean;
      env: string;
      group: string;
      space?: string;
      namespace?: string;
      instanceType: string;
      maxInstances?: number;
      accountId?: string;
      apiToken?: string;
      json?: boolean;
      offline?: boolean;
    }) => {
      if (options.offline) {
        if (!options.dockerfile) {
          console.log(chalk.red('Offline service deploy requires --dockerfile.'));
          cliExit(1);
        }

        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deployService } = await import('../lib/entities/service.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        if (!options.json) {
          console.log(`${chalk.cyan('[DEPLOY]')} service ${chalk.bold(name)} -> ${options.env} (offline)`);
          console.log(`  Dockerfile: ${options.dockerfile}`);
          console.log(`  Port:       ${options.port}`);
        }

        try {
          const result = await deployService(name, {
            dockerfile: options.dockerfile,
            port: options.port,
            ipv4: options.ipv4,
            group: options.group ?? 'takos',
            env: options.env,
            groupName: options.group ?? 'takos',
            accountId,
            apiToken,
            instanceType: options.instanceType,
            maxInstances: options.maxInstances,
            namespace: options.namespace,
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }

          if (result.success) {
            console.log(`  ${chalk.green('✓')} ${name} deployed`);
          } else {
            console.log(`  ${chalk.red('✗')} Deploy failed`);
            if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
            cliExit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to deploy service: ${message}`));
          cliExit(1);
        }
        return;
      }

      if (!options.imageRef) {
        console.log(chalk.red('Online service deploy requires --image-ref.'));
        cliExit(1);
      }

      const spaceId = resolveSpaceId(options.space);

      if (!options.json) {
        console.log(`${chalk.cyan('[DEPLOY]')} service ${chalk.bold(name)} -> ${options.env}`);
        console.log(`  Image:      ${options.imageRef}`);
        console.log(`  Port:       ${options.port}`);
        console.log(`  Provider:   ${options.provider}`);
      }

      try {
        const group = options.group
          ? await ensureGroupInSpace(spaceId, options.group)
          : null;
        const service = await ensureServiceInSpace({
          spaceId,
          name,
          groupId: group?.id ?? null,
          serviceType: 'service',
          config: {
            port: options.port,
            provider: options.provider,
            healthPath: options.healthPath ?? null,
            ipv4: options.ipv4 ?? false,
            instanceType: options.instanceType,
            maxInstances: options.maxInstances ?? null,
          },
        });
        if (group && service.group_id !== group.id) {
          await setServiceGroup(service.id, group.id);
        }
        const result = await createServiceDeployment({
          serviceId: service.id,
          imageRef: options.imageRef,
          port: options.port,
          provider: options.provider,
          healthPath: options.healthPath,
          deployMessage: `takos service deploy ${name}`,
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
        console.log(chalk.red(`Failed to deploy service: ${message}`));
        cliExit(1);
      }
    });

  serviceCmd
    .command('attach <name>')
    .description('Attach a service to a group')
    .requiredOption('--group <name>', 'Target group name')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { group: string; space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const service = await findServiceInSpace(spaceId, name, 'service');
        if (!service) {
          console.log(chalk.red(`Service not found: ${name}`));
          cliExit(1);
          return;
        }
        const group = await ensureGroupInSpace(spaceId, options.group);
        await setServiceGroup(service.id, group.id);
        console.log(chalk.green(`Attached service '${name}' to group '${group.name}'.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to attach service: ${message}`));
        cliExit(1);
      }
    });

  serviceCmd
    .command('detach <name>')
    .description('Detach a service from its group')
    .option('--space <id>', 'Target workspace ID')
    .action(async (name: string, options: { space?: string }) => {
      try {
        const spaceId = resolveSpaceId(options.space);
        const service = await findServiceInSpace(spaceId, name, 'service');
        if (!service) {
          console.log(chalk.red(`Service not found: ${name}`));
          cliExit(1);
          return;
        }
        await setServiceGroup(service.id, null);
        console.log(chalk.green(`Detached service '${name}' from its group.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to detach service: ${message}`));
        cliExit(1);
      }
    });

  serviceCmd
    .command('list')
    .description('List services in a workspace')
    .option('--group <name>', 'Target group for offline state', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (options: { group: string; space?: string; json?: boolean; offline?: boolean }) => {
      if (options.offline) {
        const { listServices } = await import('../lib/entities/service.js');
        try {
          const services = await listServices(options.group);
          if (options.json) {
            process.stdout.write(`${JSON.stringify(services, null, 2)}\n`);
            return;
          }
          if (services.length === 0) {
            console.log(chalk.dim('No services tracked. Use `takos service deploy --offline` to deploy one.'));
            return;
          }
          console.log('');
          console.log(chalk.bold('Services:'));
          for (const service of services) {
            console.log(`  ${service.name} ${chalk.dim(`[${service.imageHash}]`)}`);
          }
          console.log('');
          console.log(chalk.dim(`${services.length} service(s)`));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to list services: ${message}`));
          cliExit(1);
        }
        return;
      }

      try {
        const spaceId = resolveSpaceId(options.space);
        const services = (await listServicesInSpace(spaceId))
          .filter((service) => service.service_type === 'service');

        if (options.json) {
          process.stdout.write(`${JSON.stringify(services, null, 2)}\n`);
          return;
        }

        if (services.length === 0) {
          console.log(chalk.dim('No services found.'));
          return;
        }

        console.log('');
        console.log(chalk.bold('Services:'));
        for (const service of services) {
          const slugLabel = service.slug ? chalk.dim(` slug=${service.slug}`) : '';
          const hostnameLabel = service.hostname ? chalk.dim(` host=${service.hostname}`) : '';
          const groupLabel = service.group_id ? chalk.dim(` group=${service.group_id}`) : '';
          console.log(`  ${service.id}${slugLabel}${hostnameLabel}${groupLabel}`);
        }
        console.log('');
        console.log(chalk.dim(`${services.length} service(s)`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to list services: ${message}`));
        cliExit(1);
      }
    });

  serviceCmd
    .command('delete <name>')
    .description('Delete a service workload')
    .option('--group <name>', 'Target group for offline state', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: { group: string; space?: string; accountId?: string; apiToken?: string; offline?: boolean }) => {
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deleteService } = await import('../lib/entities/service.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);
        try {
          await deleteService(name, { group: options.group, accountId, apiToken });
          console.log(chalk.green(`Removed service '${name}' from offline state.`));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to delete service: ${message}`));
          cliExit(1);
        }
        return;
      }

      try {
        const spaceId = resolveSpaceId(options.space);
        const service = await findServiceInSpace(spaceId, name, 'service');
        if (!service) {
          console.log(chalk.red(`Service not found: ${name}`));
          cliExit(1);
          return;
        }

        const res = await api<void>(`/api/services/${encodeURIComponent(service.id)}`, { method: 'DELETE' });
        if (!res.ok) {
          console.log(chalk.red(`Error: ${res.error}`));
          cliExit(1);
        }

        console.log(chalk.green(`Deleted service '${name}'.`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to delete service: ${message}`));
        cliExit(1);
      }
    });
}
