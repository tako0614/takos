/**
 * CLI command: `takos container`
 *
 * Manage CF Containers as independent entities without requiring
 * a full app.yml manifest.
 *
 * Subcommands:
 *   takos container deploy <name> --dockerfile <path> --port <n> [--env staging]
 *   takos container list [--json]
 *   takos container delete <name>
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { cliExit } from '../lib/command-exit.js';
import {
  deployContainer,
  listContainers,
  deleteContainer,
} from '../lib/entities/container.js';

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

export function registerContainerCommand(program: Command): void {
  const containerCmd = program
    .command('container')
    .description('Manage individual CF Containers');

  // ── container deploy ───────────────────────────────────────────────────────
  containerCmd
    .command('deploy <name>')
    .description('Deploy a container')
    .requiredOption('--dockerfile <path>', 'Path to the Dockerfile')
    .requiredOption('--port <number>', 'Container port', parseInt)
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Group name', 'takos')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--instance-type <type>', 'Instance type (basic, standard)', 'basic')
    .option('--max-instances <n>', 'Maximum instances', parseInt)
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: {
      dockerfile: string;
      port: number;
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
        console.log(`${chalk.cyan('[DEPLOY]')} container ${chalk.bold(name)} -> ${options.env}`);
        console.log(`  Dockerfile: ${options.dockerfile}`);
        console.log(`  Port:       ${options.port}`);
      }

      try {
        const result = await deployContainer(name, {
          dockerfile: options.dockerfile,
          port: options.port,
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
        console.log(chalk.red(`Failed to deploy container: ${message}`));
        cliExit(1);
      }
    });

  // ── container list ─────────────────────────────────────────────────────────
  containerCmd
    .command('list')
    .description('List all tracked containers')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: { group: string; json?: boolean }) => {
      try {
        const containers = await listContainers(options.group);

        if (options.json) {
          process.stdout.write(`${JSON.stringify(containers, null, 2)}\n`);
          return;
        }

        if (containers.length === 0) {
          console.log(chalk.dim('No containers tracked. Use `takos container deploy` to deploy one.'));
          return;
        }

        console.log('');
        console.log(chalk.bold('Containers:'));
        for (const c of containers) {
          const hashLabel = c.imageHash ? chalk.dim(` [${c.imageHash}]`) : '';
          console.log(`  ${c.name}${hashLabel}`);
        }
        console.log('');
        console.log(chalk.dim(`${containers.length} container(s)`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to list containers: ${message}`));
        cliExit(1);
      }
    });

  // ── container delete ───────────────────────────────────────────────────────
  containerCmd
    .command('delete <name>')
    .description('Delete a container from state (does NOT delete the actual container)')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .action(async (name: string, options: { group: string; accountId?: string; apiToken?: string }) => {
      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

      try {
        await deleteContainer(name, { group: options.group, accountId, apiToken });
        console.log(chalk.green(`Removed container '${name}' from state.`));
        console.log(chalk.dim('The actual container was NOT deleted.'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to delete container: ${message}`));
        cliExit(1);
      }
    });
}
