/**
 * CLI command: `takos resource`
 *
 * Manage resources (D1, R2, KV, Queue, Vectorize, Secrets) as
 * independent entities.
 *
 * Default (online): CRUD via the takos API.
 * --offline: Delegate to the local entity operations.
 *
 * Subcommands:
 *   takos resource create <name> --type <type> [--binding BINDING] [--env staging]
 *   takos resource list [--env staging] [--json]
 *   takos resource delete <name> [--env staging]
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { cliExit } from '../lib/command-exit.js';
import { api } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import type { ResourceType } from '../lib/entities/resource.js';

const VALID_RESOURCE_TYPES: ResourceType[] = ['d1', 'r2', 'kv', 'queue', 'vectorize', 'secretRef'];

function resolveSpaceId(spaceOverride?: string): string {
  const spaceId = String(spaceOverride || getConfig().spaceId || '').trim();
  if (!spaceId) {
    console.log(chalk.red('Workspace ID is required. Pass --space or configure a default workspace.'));
    cliExit(1);
  }
  return spaceId;
}

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
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: {
      type: string;
      binding?: string;
      env: string;
      group: string;
      space?: string;
      accountId?: string;
      apiToken?: string;
      json?: boolean;
      offline?: boolean;
    }) => {
      // Validate resource type
      if (!VALID_RESOURCE_TYPES.includes(options.type as ResourceType)) {
        console.log(chalk.red(`Invalid resource type: ${options.type}`));
        console.log(chalk.dim(`Valid types: ${VALID_RESOURCE_TYPES.join(', ')}`));
        cliExit(1);
      }

      // Offline mode: delegate to local entity operations
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { createResource } = await import('../lib/entities/resource.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        if (!options.json) {
          console.log(`${chalk.cyan('[CREATE]')} resource ${chalk.bold(name)} [${options.type}] -> ${options.env} (offline)`);
        }

        try {
          const result = await createResource(name, {
            type: options.type as ResourceType,
            binding: options.binding,
            env: options.env,
            group: options.group,
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
        return;
      }

      // Online mode: API call
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      if (!options.json) {
        console.log(`${chalk.cyan('[CREATE]')} resource ${chalk.bold(name)} [${options.type}] -> ${options.env}`);
      }

      const res = await api<{ name: string; type: string; id?: string; status: string; error?: string }>(
        `/api/spaces/${spaceId}/groups/${group}/entities`, {
          method: 'POST',
          body: {
            category: 'resource',
            name,
            config: {
              type: options.type,
              binding: options.binding,
              env: options.env,
            },
          },
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
    });

  // ── resource list ──────────────────────────────────────────────────────────
  resourceCmd
    .command('list')
    .description('List all tracked resources')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (options: { group: string; space?: string; json?: boolean; offline?: boolean }) => {
      // Offline mode
      if (options.offline) {
        const { listResources } = await import('../lib/entities/resource.js');
        try {
          const resources = await listResources(options.group);
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
        return;
      }

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<Array<{ name: string; type: string; id?: string; binding?: string }>>(
        `/api/spaces/${spaceId}/groups/${group}/entities?category=resource`,
      );

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      const resources = res.data;
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
    });

  // ── resource delete ────────────────────────────────────────────────────────
  resourceCmd
    .command('delete <name>')
    .description('Delete a resource from state (does NOT delete the actual cloud resource)')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: { group: string; space?: string; accountId?: string; apiToken?: string; offline?: boolean }) => {
      // Offline mode
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deleteResource } = await import('../lib/entities/resource.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);
        try {
          await deleteResource(name, { group: options.group, accountId, apiToken });
          console.log(chalk.green(`Removed resource '${name}' from state.`));
          console.log(chalk.dim('The actual cloud resource was NOT deleted.'));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to delete resource: ${message}`));
          cliExit(1);
        }
        return;
      }

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<void>(
        `/api/spaces/${spaceId}/groups/${group}/entities/resource/${name}`,
        { method: 'DELETE' },
      );

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      console.log(chalk.green(`Removed resource '${name}' from state.`));
      console.log(chalk.dim('The actual cloud resource was NOT deleted.'));
    });
}
