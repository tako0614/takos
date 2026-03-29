/**
 * CLI command: `takos service`
 *
 * Manage persistent services (long-running containers, optionally with
 * dedicated IPv4) as independent entities.
 *
 * Default (online): CRUD via the takos API.
 * --offline: Delegate to the local entity operations.
 *
 * Subcommands:
 *   takos service deploy <name> --dockerfile <path> --port <n> [--ipv4] [--env staging]
 *   takos service list [--json]
 *   takos service delete <name>
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { cliExit } from '../lib/command-exit.js';
import { api } from '../lib/api.js';
import { getConfig } from '../lib/config.js';

function resolveSpaceId(spaceOverride?: string): string {
  const spaceId = String(spaceOverride || getConfig().spaceId || '').trim();
  if (!spaceId) {
    console.log(chalk.red('Workspace ID is required. Pass --space or configure a default workspace.'));
    cliExit(1);
  }
  return spaceId;
}

// ── Command registration ─────────────────────────────────────────────────────

export function registerServiceCommand(program: Command): void {
  const serviceCmd = program
    .command('service')
    .description('Manage persistent services (long-running containers)');

  // ── service deploy ─────────────────────────────────────────────────────────
  serviceCmd
    .command('deploy <name>')
    .description('Deploy a persistent service')
    .requiredOption('--dockerfile <path>', 'Path to the Dockerfile')
    .requiredOption('--port <number>', 'Service port', parseInt)
    .option('--ipv4', 'Request a dedicated IPv4 address')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Group name', 'takos')
    .option('--space <id>', 'Target workspace ID')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--instance-type <type>', 'Instance type', 'basic')
    .option('--max-instances <n>', 'Maximum instances', parseInt)
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: {
      dockerfile: string;
      port: number;
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
      // Offline mode: delegate to local entity operations
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deployService } = await import('../lib/entities/service.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        if (!options.json) {
          console.log(`${chalk.cyan('[DEPLOY]')} service ${chalk.bold(name)} -> ${options.env} (offline)`);
          console.log(`  Dockerfile: ${options.dockerfile}`);
          console.log(`  Port:       ${options.port}`);
          if (options.ipv4) {
            console.log(`  IPv4:       requested`);
          }
        }

        try {
          const result = await deployService(name, {
            dockerfile: options.dockerfile,
            port: options.port,
            ipv4: options.ipv4,
            group: options.group,
            env: options.env,
            groupName: options.group,
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
            const scriptInfo = result.scriptName ? chalk.dim(` -> ${result.scriptName}`) : '';
            console.log(`  ${chalk.green('✓')} ${name} deployed${scriptInfo}`);
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

      // Online mode: apply via API targeting a specific service
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      if (!options.json) {
        console.log(`${chalk.cyan('[DEPLOY]')} service ${chalk.bold(name)} -> ${options.env}`);
        console.log(`  Dockerfile: ${options.dockerfile}`);
        console.log(`  Port:       ${options.port}`);
        if (options.ipv4) {
          console.log(`  IPv4:       requested`);
        }
      }

      const res = await api<{ success: boolean; scriptName?: string; error?: string }>(
        `/api/spaces/${spaceId}/groups/${group}/apply`, {
          method: 'POST',
          body: {
            manifest: null,
            target: [`services.${name}`],
          },
          timeout: 120_000,
        },
      );

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      const result = res.data;
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      if (result.success) {
        const scriptInfo = result.scriptName ? chalk.dim(` -> ${result.scriptName}`) : '';
        console.log(`  ${chalk.green('✓')} ${name} deployed${scriptInfo}`);
      } else {
        console.log(`  ${chalk.red('✗')} Deploy failed`);
        if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
        cliExit(1);
      }
    });

  // ── service list ───────────────────────────────────────────────────────────
  serviceCmd
    .command('list')
    .description('List all tracked services')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (options: { group: string; space?: string; json?: boolean; offline?: boolean }) => {
      // Offline mode
      if (options.offline) {
        const { listServices } = await import('../lib/entities/service.js');
        try {
          const services = await listServices(options.group);
          if (options.json) {
            process.stdout.write(`${JSON.stringify(services, null, 2)}\n`);
            return;
          }
          if (services.length === 0) {
            console.log(chalk.dim('No services tracked. Use `takos service deploy` to deploy one.'));
            return;
          }
          console.log('');
          console.log(chalk.bold('Services:'));
          for (const s of services) {
            const hashLabel = s.imageHash ? chalk.dim(` [${s.imageHash}]`) : '';
            const ipLabel = s.ipv4 ? chalk.dim(` (${s.ipv4})`) : '';
            console.log(`  ${s.name}${hashLabel}${ipLabel}`);
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

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<Array<{ name: string; imageHash?: string; ipv4?: string }>>(
        `/api/spaces/${spaceId}/groups/${group}/entities?category=service`,
      );

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      const services = res.data;
      if (options.json) {
        process.stdout.write(`${JSON.stringify(services, null, 2)}\n`);
        return;
      }

      if (services.length === 0) {
        console.log(chalk.dim('No services tracked. Use `takos service deploy` to deploy one.'));
        return;
      }

      console.log('');
      console.log(chalk.bold('Services:'));
      for (const s of services) {
        const hashLabel = s.imageHash ? chalk.dim(` [${s.imageHash}]`) : '';
        const ipLabel = s.ipv4 ? chalk.dim(` (${s.ipv4})`) : '';
        console.log(`  ${s.name}${hashLabel}${ipLabel}`);
      }
      console.log('');
      console.log(chalk.dim(`${services.length} service(s)`));
    });

  // ── service delete ─────────────────────────────────────────────────────────
  serviceCmd
    .command('delete <name>')
    .description('Delete a service from state (does NOT delete the actual service)')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: { group: string; space?: string; accountId?: string; apiToken?: string; offline?: boolean }) => {
      // Offline mode
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deleteService } = await import('../lib/entities/service.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);
        try {
          await deleteService(name, { group: options.group, accountId, apiToken });
          console.log(chalk.green(`Removed service '${name}' from state.`));
          console.log(chalk.dim('The actual service was NOT deleted.'));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to delete service: ${message}`));
          cliExit(1);
        }
        return;
      }

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<void>(
        `/api/spaces/${spaceId}/groups/${group}/entities/service/${name}`,
        { method: 'DELETE' },
      );

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      console.log(chalk.green(`Removed service '${name}' from state.`));
      console.log(chalk.dim('The actual service was NOT deleted.'));
    });
}
