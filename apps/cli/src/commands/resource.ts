/**
 * CLI command: `takos resource`
 *
 * Manage resources (D1, R2, KV, Queue, Vectorize, Secrets) as
 * independent entities without requiring a full app.yml manifest.
 *
 * Subcommands:
 *   takos resource create <name> --type <type> [--binding BINDING] [--env staging]
 *   takos resource list [--env staging] [--json]
 *   takos resource delete <name> [--env staging]
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { cliExit } from '../lib/command-exit.js';
import {
  createResource,
  listResources,
  deleteResource,
} from '../lib/entities/resource.js';
import type { ResourceType } from '../lib/entities/resource.js';

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

const VALID_RESOURCE_TYPES: ResourceType[] = ['d1', 'r2', 'kv', 'queue', 'vectorize', 'secretRef'];

// ── Command registration ─────────────────────────────────────────────────────

export function registerResourceCommand(program: Command): void {
  const resourceCmd = program
    .command('resource')
    .description('Manage individual resources (D1, R2, KV, Queue, Vectorize, Secrets)');

  // ── resource create ────────────────────────────────────────────────────────
  resourceCmd
    .command('create <name>')
    .description('Create a new resource')
    .requiredOption('--type <type>', `Resource type (${VALID_RESOURCE_TYPES.join(', ')})`)
    .option('--binding <binding>', 'Custom binding name')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Group name', 'takos')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: {
      type: string;
      binding?: string;
      env: string;
      group: string;
      accountId?: string;
      apiToken?: string;
      json?: boolean;
    }) => {
      // Validate resource type
      if (!VALID_RESOURCE_TYPES.includes(options.type as ResourceType)) {
        console.log(chalk.red(`Invalid resource type: ${options.type}`));
        console.log(chalk.dim(`Valid types: ${VALID_RESOURCE_TYPES.join(', ')}`));
        cliExit(1);
      }

      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

      if (!options.json) {
        console.log(`${chalk.cyan('[CREATE]')} resource ${chalk.bold(name)} [${options.type}] -> ${options.env}`);
      }

      try {
        const result = await createResource(name, {
          type: options.type as ResourceType,
          binding: options.binding,
          env: options.env,
          groupName: options.group,
          accountId,
          apiToken,
        });

        if (options.json) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }

        const icon = result.status === 'provisioned' ? chalk.green('✓')
          : result.status === 'exists' ? chalk.yellow('~')
          : result.status === 'skipped' ? chalk.yellow('-')
          : chalk.red('✗');
        const idInfo = result.id ? chalk.dim(` (${result.id})`) : '';
        console.log(`  ${icon} ${result.name} [${result.type}] ${result.status}${idInfo}`);

        if (result.status === 'failed') {
          if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
          cliExit(1);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to create resource: ${message}`));
        cliExit(1);
      }
    });

  // ── resource list ──────────────────────────────────────────────────────────
  resourceCmd
    .command('list')
    .description('List all tracked resources')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: { json?: boolean }) => {
      try {
        const resources = await listResources();

        if (options.json) {
          process.stdout.write(`${JSON.stringify(resources, null, 2)}\n`);
          return;
        }

        if (resources.length === 0) {
          console.log(chalk.dim('No resources tracked. Use `takos resource create` to create one.'));
          return;
        }

        console.log('');
        console.log(chalk.bold('Resources:'));
        for (const r of resources) {
          const idLabel = r.id ? chalk.dim(` (${r.id})`) : '';
          const bindingLabel = r.binding ? chalk.dim(` binding=${r.binding}`) : '';
          console.log(`  ${r.name} [${r.type}]${idLabel}${bindingLabel}`);
        }
        console.log('');
        console.log(chalk.dim(`${resources.length} resource(s)`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to list resources: ${message}`));
        cliExit(1);
      }
    });

  // ── resource delete ────────────────────────────────────────────────────────
  resourceCmd
    .command('delete <name>')
    .description('Delete a resource from state (does NOT delete the actual cloud resource)')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .action(async (name: string, options: { accountId?: string; apiToken?: string }) => {
      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

      try {
        await deleteResource(name, { accountId, apiToken });
        console.log(chalk.green(`Removed resource '${name}' from state.`));
        console.log(chalk.dim('The actual cloud resource was NOT deleted.'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Failed to delete resource: ${message}`));
        cliExit(1);
      }
    });
}
