/**
 * CLI command: `takos service`
 *
 * Manage persistent services (long-running containers, optionally with
 * dedicated IPv4) as independent entities.
 *
 * Subcommands:
 *   takos service deploy <name> --dockerfile <path> --port <n> [--ipv4] [--env staging]
 *   takos service list [--json]
 *   takos service delete <name>
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { cliExit } from '../lib/command-exit.js';
import {
  deployService,
  listServices,
  deleteService,
} from '../lib/entities/service.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveAccountId(override?: string): string {
  const accountId = override || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '';
  if (!accountId.trim()) {
    console.log(chalk.red('Cloudflare account ID is required.'));
    console.log(chalk.dim('Pass --account-id, or set CLOUDFLARE_ACCOUNT_ID.'));
    cliExit(1);
  }
  return accountId.trim();
}

function resolveApiToken(override?: string): string {
  const apiToken = override || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
  if (!apiToken.trim()) {
    console.log(chalk.red('Cloudflare API token is required.'));
    console.log(chalk.dim('Pass --api-token, or set CLOUDFLARE_API_TOKEN.'));
    cliExit(1);
  }
  return apiToken.trim();
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
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--instance-type <type>', 'Instance type', 'basic')
    .option('--max-instances <n>', 'Maximum instances', parseInt)
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: {
      dockerfile: string;
      port: number;
      ipv4?: boolean;
      env: string;
      group: string;
      namespace?: string;
      instanceType: string;
      maxInstances?: number;
      accountId?: string;
      apiToken?: string;
      json?: boolean;
    }) => {
      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

      if (!options.json) {
        console.log(`${chalk.cyan('[DEPLOY]')} service ${chalk.bold(name)} -> ${options.env}`);
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
    });

  // ── service list ───────────────────────────────────────────────────────────
  serviceCmd
    .command('list')
    .description('List all tracked services')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: { group: string; json?: boolean }) => {
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
    });

  // ── service delete ─────────────────────────────────────────────────────────
  serviceCmd
    .command('delete <name>')
    .description('Delete a service from state (does NOT delete the actual service)')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .action(async (name: string, options: { group: string; accountId?: string; apiToken?: string }) => {
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
    });
}
