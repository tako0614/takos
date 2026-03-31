/**
 * CLI command: `takos container`
 *
 * Manage CF Containers as independent entities.
 *
 * Default (online): CRUD via the takos API.
 * --offline: Delegate to the local entity operations.
 *
 * Subcommands:
 *   takos container deploy <name> --dockerfile <path> --port <n> [--env staging]
 *   takos container list [--json]
 *   takos container delete <name>
 */
import { Command } from 'commander';
import { bold, cyan, dim, green, red } from '@std/fmt/colors';
import { cliExit } from '../lib/command-exit.ts';
import { api } from '../lib/api.ts';
import { resolveSpaceId } from '../lib/cli-utils.ts';

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
    .option('--space <id>', 'Target workspace ID')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--instance-type <type>', 'Instance type (basic, standard)', 'basic')
    .option('--max-instances <n>', 'Maximum instances', parseInt)
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: {
      dockerfile: string;
      port: number;
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
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.ts');
        const { deployContainer } = await import('../lib/entities/container.ts');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);

        if (!options.json) {
          console.log(`${cyan('[DEPLOY]')} container ${bold(name)} -> ${options.env} (offline)`);
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
            const scriptInfo = result.scriptName ? dim(` -> ${result.scriptName}`) : '';
            console.log(`  ${green('✓')} ${name} deployed${scriptInfo}`);
          } else {
            console.log(`  ${red('✗')} Deploy failed`);
            if (result.error) console.log(red(`  Error: ${result.error}`));
            cliExit(1);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(red(`Failed to deploy container: ${message}`));
          cliExit(1);
        }
        return;
      }

      // Online mode: apply via API targeting a specific container
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      if (!options.json) {
        console.log(`${cyan('[DEPLOY]')} container ${bold(name)} -> ${options.env}`);
        console.log(`  Dockerfile: ${options.dockerfile}`);
        console.log(`  Port:       ${options.port}`);
      }

      const res = await api<{ success: boolean; scriptName?: string; error?: string }>(
        `/api/spaces/${spaceId}/groups/${group}/apply`, {
          method: 'POST',
          body: {
            manifest: null,
            target: [`containers.${name}`],
          },
          timeout: 120_000,
        },
      );

      if (!res.ok) {
        console.log(red(`Error: ${res.error}`));
        cliExit(1);
      }

      const result = res.data;
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return;
      }

      if (result.success) {
        const scriptInfo = result.scriptName ? dim(` -> ${result.scriptName}`) : '';
        console.log(`  ${green('✓')} ${name} deployed${scriptInfo}`);
      } else {
        console.log(`  ${red('✗')} Deploy failed`);
        if (result.error) console.log(red(`  Error: ${result.error}`));
        cliExit(1);
      }
    });

  // ── container list ─────────────────────────────────────────────────────────
  containerCmd
    .command('list')
    .description('List all tracked containers')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (options: { group: string; space?: string; json?: boolean; offline?: boolean }) => {
      // Offline mode
      if (options.offline) {
        const { listContainers } = await import('../lib/entities/container.ts');
        try {
          const containers = await listContainers(options.group);
          if (options.json) {
            process.stdout.write(`${JSON.stringify(containers, null, 2)}\n`);
            return;
          }
          if (containers.length === 0) {
            console.log(dim('No containers tracked. Use `takos container deploy` to deploy one.'));
            return;
          }
          console.log('');
          console.log(bold('Containers:'));
          for (const c of containers) {
            const hashLabel = c.imageHash ? dim(` [${c.imageHash}]`) : '';
            console.log(`  ${c.name}${hashLabel}`);
          }
          console.log('');
          console.log(dim(`${containers.length} container(s)`));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(red(`Failed to list containers: ${message}`));
          cliExit(1);
        }
        return;
      }

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<Array<{ name: string; imageHash?: string }>>(
        `/api/spaces/${spaceId}/groups/${group}/entities?category=container`,
      );

      if (!res.ok) {
        console.log(red(`Error: ${res.error}`));
        cliExit(1);
      }

      const containers = res.data;
      if (options.json) {
        process.stdout.write(`${JSON.stringify(containers, null, 2)}\n`);
        return;
      }

      if (containers.length === 0) {
        console.log(dim('No containers tracked. Use `takos container deploy` to deploy one.'));
        return;
      }

      console.log('');
      console.log(bold('Containers:'));
      for (const c of containers) {
        const hashLabel = c.imageHash ? dim(` [${c.imageHash}]`) : '';
        console.log(`  ${c.name}${hashLabel}`);
      }
      console.log('');
      console.log(dim(`${containers.length} container(s)`));
    });

  // ── container delete ───────────────────────────────────────────────────────
  containerCmd
    .command('delete <name>')
    .description('Delete a container from state (does NOT delete the actual container)')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--space <id>', 'Target workspace ID')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--offline', 'Force local entity operations (skip API)')
    .action(async (name: string, options: { group: string; space?: string; accountId?: string; apiToken?: string; offline?: boolean }) => {
      // Offline mode
      if (options.offline) {
        const { resolveAccountId, resolveApiToken } = await import('../lib/cli-utils.ts');
        const { deleteContainer } = await import('../lib/entities/container.ts');
        const accountId = resolveAccountId(options.accountId);
        const apiToken = resolveApiToken(options.apiToken);
        try {
          await deleteContainer(name, { group: options.group, accountId, apiToken });
          console.log(green(`Removed container '${name}' from state.`));
          console.log(dim('The actual container was NOT deleted.'));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(red(`Failed to delete container: ${message}`));
          cliExit(1);
        }
        return;
      }

      // Online mode
      const spaceId = resolveSpaceId(options.space);
      const group = options.group;

      const res = await api<void>(
        `/api/spaces/${spaceId}/groups/${group}/entities/container/${name}`,
        { method: 'DELETE' },
      );

      if (!res.ok) {
        console.log(red(`Error: ${res.error}`));
        cliExit(1);
      }

      console.log(green(`Removed container '${name}' from state.`));
      console.log(dim('The actual container was NOT deleted.'));
    });
}
