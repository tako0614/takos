/**
 * CLI command: `takos worker`
 *
 * Manage Cloudflare Workers as independent entities.
 *
 * Default (online): CRUD via the takos API.
 * --offline: Delegate to the local entity operations.
 *
 * Subcommands:
 *   takos worker deploy <name> [--artifact path] [--env staging]
 *   takos worker list [--json]
 *   takos worker delete <name> [--env staging]
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

export function registerWorkerCommand(program: Command): void {
  const workerCmd = program
    .command('worker')
    .description('Manage individual Cloudflare Workers');

  // ── worker deploy ──────────────────────────────────────────────────────────
  workerCmd
    .command('deploy <name>')
    .description('Deploy a worker')
    .option('--artifact <path>', 'Path to the built artifact (JS/TS entry point)')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Group name', 'takos')
    .option('--space <id>', 'Target workspace ID')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: {
      artifact?: string;
      env: string;
      group: string;
      space?: string;
      namespace?: string;
      accountId?: string;
      apiToken?: string;
      json?: boolean;
      offline?: boolean;
    }) => {
      // Offline mode: delegate to local entity operations
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deployWorker } = await import('../lib/entities/worker.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        if (!options.json) {
          console.log(`${chalk.cyan('[DEPLOY]')} worker ${chalk.bold(name)} -> ${options.env} (offline)`);
          if (options.artifact) {
            console.log(`  Artifact: ${options.artifact}`);
          }
        }

        try {
          const result = await deployWorker(name, {
            artifact: options.artifact,
            group: options.group,
            env: options.env,
            groupName: options.group,
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

      // Online mode: apply via API targeting a specific worker
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      if (!options.json) {
        console.log(`${chalk.cyan('[DEPLOY]')} worker ${chalk.bold(name)} -> ${options.env}`);
        if (options.artifact) {
          console.log(`  Artifact: ${options.artifact}`);
        }
      }

      const res = await api<{ success: boolean; scriptName?: string; error?: string }>(
        `/api/spaces/${spaceId}/groups/${group}/apply`, {
          method: 'POST',
          body: {
            manifest: null,
            target: [`workers.${name}`],
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
        const scriptLabel = result.scriptName ? ` ${result.scriptName}` : '';
        console.log(`  ${chalk.green('✓')}${scriptLabel} deployed`);
      } else {
        console.log(`  ${chalk.red('✗')} Deploy failed`);
        if (result.error) console.log(chalk.red(`  Error: ${result.error}`));
        cliExit(1);
      }
    });

  // ── worker list ────────────────────────────────────────────────────────────
  workerCmd
    .command('list')
    .description('List all tracked workers')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (options: { group: string; space?: string; json?: boolean; offline?: boolean }) => {
      // Offline mode
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
          for (const w of workers) {
            const scriptLabel = chalk.dim(` -> ${w.scriptName}`);
            const hashLabel = w.codeHash ? chalk.dim(` [${w.codeHash}]`) : '';
            const containerLabel = w.containers && w.containers.length > 0
              ? chalk.dim(` (containers: ${w.containers.join(', ')})`)
              : '';
            console.log(`  ${w.name}${scriptLabel}${hashLabel}${containerLabel}`);
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

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<Array<{ name: string; scriptName: string; codeHash?: string; containers?: string[] }>>(
        `/api/spaces/${spaceId}/groups/${group}/entities?category=worker`,
      );

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      const workers = res.data;
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
      for (const w of workers) {
        const scriptLabel = chalk.dim(` -> ${w.scriptName}`);
        const hashLabel = w.codeHash ? chalk.dim(` [${w.codeHash}]`) : '';
        const containerLabel = w.containers && w.containers.length > 0
          ? chalk.dim(` (containers: ${w.containers.join(', ')})`)
          : '';
        console.log(`  ${w.name}${scriptLabel}${hashLabel}${containerLabel}`);
      }
      console.log('');
      console.log(chalk.dim(`${workers.length} worker(s)`));
    });

  // ── worker delete ──────────────────────────────────────────────────────────
  workerCmd
    .command('delete <name>')
    .description('Delete a worker from state (does NOT delete the actual worker)')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: { group: string; space?: string; accountId?: string; apiToken?: string; offline?: boolean }) => {
      // Offline mode
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.js');
        const { deleteWorker } = await import('../lib/entities/worker.js');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);
        try {
          await deleteWorker(name, { group: options.group, accountId, apiToken });
          console.log(chalk.green(`Removed worker '${name}' from state.`));
          console.log(chalk.dim('The actual worker was NOT deleted.'));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.red(`Failed to delete worker: ${message}`));
          cliExit(1);
        }
        return;
      }

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<void>(
        `/api/spaces/${spaceId}/groups/${group}/entities/worker/${name}`,
        { method: 'DELETE' },
      );

      if (!res.ok) {
        console.log(chalk.red(`Error: ${res.error}`));
        cliExit(1);
      }

      console.log(chalk.green(`Removed worker '${name}' from state.`));
      console.log(chalk.dim('The actual worker was NOT deleted.'));
    });
}
