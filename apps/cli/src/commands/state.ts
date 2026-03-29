/**
 * CLI command: `takos state`
 *
 * Manage group state (API-backed with file fallback).
 *
 * By default state is fetched from the takos API.  When the API is
 * unavailable or `--offline` is passed, the local file backend
 * (.takos/state.{group}.json) is used instead.
 *
 * Subcommands:
 *   takos state list                      -- Show all tracked resources/services
 *   takos state show <key>                -- Show details for a specific entry
 *   takos state import <key> <id>         -- Import an existing resource into state
 *   takos state rm <key>                  -- Remove entry from state (does NOT delete the actual resource)
 *   takos state refresh                   -- Verify live resources where possible and remove confirmed orphans
 *   takos state sync                      -- Synchronise local and remote state
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readState, writeState, getStateDir, getStateFilePath } from '../lib/state/state-file.js';
import type { StateAccessOptions } from '../lib/state/state-file.js';
import { refreshState } from '../lib/state/refresh.js';
import { createStateRefreshProvider } from '../lib/state/cloudflare-refresh-provider.js';
import { syncState } from '../lib/state/sync.js';
import { cliExit } from '../lib/command-exit.js';
import { printJson } from '../lib/cli-utils.js';
import type { TakosState } from '../lib/state/state-types.js';

type StateCategory = 'resources' | 'workers' | 'containers' | 'services' | 'routes';

/**
 * Resolve a dotted key like "resources.db" or "services.web" against
 * the TakosState structure. Returns { category, name, entry } or null.
 */
function resolveStateKey(state: TakosState, key: string): {
  category: StateCategory;
  name: string;
  entry: Record<string, unknown>;
} | null {
  const categories: StateCategory[] = ['resources', 'workers', 'containers', 'services', 'routes'];
  const parts = key.split('.');
  if (parts.length === 2) {
    const [category, name] = parts;
    if (categories.includes(category as StateCategory)) {
      const bucket = state[category as StateCategory];
      if (bucket && name in bucket) {
        return { category: category as StateCategory, name, entry: bucket[name] as unknown as Record<string, unknown> };
      }
    }
    return null;
  }
  // Try bare name in all categories
  for (const cat of categories) {
    const bucket = state[cat];
    if (bucket && key in bucket) {
      return { category: cat, name: key, entry: bucket[key] as unknown as Record<string, unknown> };
    }
  }
  return null;
}

function toAccessOpts(options: { offline?: boolean }): StateAccessOptions {
  return options.offline ? { offline: true } : {};
}

export function registerStateCommand(program: Command): void {
  const stateCmd = program
    .command('state')
    .description('Manage state (API-backed with file fallback)');

  // ── state list ──────────────────────────────────────────────────────────────
  stateCmd
    .command('list')
    .description('List all tracked resources and services')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: { group: string; json?: boolean; offline?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.dim('No state found. Run `takos apply` first.'));
        return;
      }

      if (options.json) {
        printJson(state);
        return;
      }

      console.log('');
      console.log(chalk.bold(`State: ${state.groupName || '(unknown)'}`));
      console.log(`  Provider:    ${state.provider || '(unknown)'}`);
      console.log(`  Environment: ${state.env || '(unknown)'}`);
      console.log(`  Version:     ${state.version || '(unknown)'}`);
      console.log(`  Updated at:  ${state.updatedAt || '(never)'}`);
      if (accessOpts.offline) {
        const stateFilePath = getStateFilePath(stateDir, group);
        console.log(`  State file:  ${stateFilePath}`);
      }
      console.log('');

      const resources = state.resources || {};
      const workers = state.workers || {};
      const containers = state.containers || {};
      const services = state.services || {};
      const resourceKeys = Object.keys(resources);
      const workerKeys = Object.keys(workers);
      const containerKeys = Object.keys(containers);
      const serviceKeys = Object.keys(services);

      if (resourceKeys.length > 0) {
        console.log(chalk.bold('Resources:'));
        for (const name of resourceKeys) {
          const r = resources[name];
          const typeLabel = r.type ? `[${r.type}]` : '';
          const idLabel = r.id ? chalk.dim(` (${r.id})`) : '';
          console.log(`  resources.${name} ${typeLabel}${idLabel}`);
        }
        console.log('');
      }

      if (workerKeys.length > 0) {
        console.log(chalk.bold('Workers:'));
        for (const name of workerKeys) {
          const w = workers[name];
          const scriptLabel = w.scriptName ? chalk.dim(` -> ${w.scriptName}`) : '';
          console.log(`  workers.${name} [worker]${scriptLabel}`);
        }
        console.log('');
      }

      if (containerKeys.length > 0) {
        console.log(chalk.bold('Containers:'));
        for (const name of containerKeys) {
          console.log(`  containers.${name} [container]`);
        }
        console.log('');
      }

      if (serviceKeys.length > 0) {
        console.log(chalk.bold('Services:'));
        for (const name of serviceKeys) {
          const s = services[name];
          const ipLabel = s.ipv4 ? chalk.dim(` (${s.ipv4})`) : '';
          console.log(`  services.${name} [service]${ipLabel}`);
        }
        console.log('');
      }

      const totalCount = resourceKeys.length + workerKeys.length + containerKeys.length + serviceKeys.length;
      if (totalCount === 0) {
        console.log(chalk.dim('State is empty.'));
      }

      console.log(chalk.dim(`${resourceKeys.length} resource(s), ${workerKeys.length} worker(s), ${containerKeys.length} container(s), ${serviceKeys.length} service(s)`));
    });

  // ── state show ──────────────────────────────────────────────────────────────
  stateCmd
    .command('show <key>')
    .description('Show details for a specific resource or service (e.g. resources.db)')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (key: string, options: { group: string; json?: boolean; offline?: boolean }) => {
      const group = options.group;
      const stateDir = getStateDir(process.cwd());
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.red('No state found. Run `takos apply` first.'));
        cliExit(1);
        return; // unreachable, helps TS narrow
      }

      const resolved = resolveStateKey(state, key);
      if (!resolved) {
        console.log(chalk.red(`Not found in state: ${key}`));
        console.log(chalk.dim('Use `takos state list` to see available entries.'));
        cliExit(1);
      }

      if (options.json) {
        printJson({ category: resolved.category, name: resolved.name, ...resolved.entry });
        return;
      }

      console.log('');
      console.log(chalk.bold(`${resolved.category}.${resolved.name}`));
      for (const [field, value] of Object.entries(resolved.entry)) {
        if (value !== undefined && value !== null) {
          console.log(`  ${field}: ${value}`);
        }
      }
      console.log('');
    });

  // ── state import ────────────────────────────────────────────────────────────
  stateCmd
    .command('import <key> <id>')
    .description('Import an existing resource into state (e.g. state import resources.db abc123)')
    .option('--group <name>', 'Group name', 'default')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (key: string, id: string, options: { group: string; offline?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      const now = new Date().toISOString();
      if (!state) {
        state = {
          version: 1,
          provider: 'cloudflare',
          env: 'unknown',
          group,
          groupName: 'unknown',
          updatedAt: now,
          resources: {},
          workers: {},
          containers: {},
          services: {},
          routes: {},
        };
      }

      const parts = key.split('.');
      if (parts.length !== 2) {
        console.log(chalk.red('Key must be in the format "category.name" (e.g. resources.db)'));
        cliExit(1);
      }

      const [category, name] = parts;
      if (category === 'resources') {
        state.resources[name] = {
          type: 'unknown',
          id,
          binding: name,
          createdAt: now,
        };
      } else if (category === 'workers') {
        state.workers[name] = {
          scriptName: id,
          deployedAt: now,
          codeHash: '',
        };
      } else if (category === 'containers') {
        state.containers[name] = {
          deployedAt: now,
          imageHash: '',
        };
      } else if (category === 'services') {
        state.services[name] = {
          deployedAt: now,
          imageHash: '',
        };
      } else {
        console.log(chalk.red(`Unknown category: ${category}. Use "resources", "workers", "containers", or "services".`));
        cliExit(1);
      }

      state.updatedAt = now;
      await writeState(stateDir, group, state, accessOpts);
      console.log(chalk.green(`Imported ${key} with id ${id}`));
    });

  // ── state rm ────────────────────────────────────────────────────────────────
  stateCmd
    .command('rm <key>')
    .description('Remove an entry from state (does NOT delete the actual resource)')
    .option('--group <name>', 'Group name', 'default')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (key: string, options: { group: string; offline?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.red('No state found. Nothing to remove.'));
        cliExit(1);
        return; // unreachable, helps TS narrow
      }

      const resolved = resolveStateKey(state, key);
      if (!resolved) {
        console.log(chalk.red(`Not found in state: ${key}`));
        console.log(chalk.dim('Use `takos state list` to see available entries.'));
        cliExit(1);
        return; // unreachable, helps TS narrow
      }

      if (resolved.category === 'resources') {
        delete state.resources[resolved.name];
      } else if (resolved.category === 'workers') {
        delete state.workers[resolved.name];
      } else if (resolved.category === 'containers') {
        delete state.containers[resolved.name];
      } else if (resolved.category === 'services') {
        delete state.services[resolved.name];
      } else if (resolved.category === 'routes') {
        delete state.routes[resolved.name];
      }

      await writeState(stateDir, group, state, accessOpts);
      console.log(chalk.green(`Removed ${resolved.category}.${resolved.name} from state`));
      console.log(chalk.dim('The actual resource was NOT deleted. Use provider tools to delete it.'));
    });

  // ── state refresh ───────────────────────────────────────────────────────────
  stateCmd
    .command('refresh')
    .description('Verify live resources where possible and remove confirmed orphaned entries')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .option('--offline', 'Force file-based state (skip API)')
    .option('--dry-run', 'Show what would change without modifying state')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .action(async (options: { group: string; json?: boolean; offline?: boolean; dryRun?: boolean; accountId?: string; apiToken?: string }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      let state: TakosState | null;
      try {
        state = await readState(stateDir, group, accessOpts);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.dim('No state found. Nothing to refresh.'));
        return;
      }

      const provider = createStateRefreshProvider({
        provider: state.provider,
        accountId: options.accountId?.trim() || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || undefined,
        apiToken: options.apiToken?.trim() || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || undefined,
      });

      // Work on a copy for dry-run; mutate the original otherwise
      const workingState = options.dryRun
        ? (JSON.parse(JSON.stringify(state)) as TakosState)
        : state;

      const result = await refreshState(workingState, provider);

      if (options.json) {
        printJson(result);
        return;
      }

      const removed = result.changes.filter((c) => c.action === 'removed').length;
      const warnings = result.changes.filter((c) => c.action === 'warning').length;

      if (removed === 0 && warnings === 0) {
        console.log(chalk.green('State is consistent — no orphaned entries found.'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`Refresh result for group "${group}":`));
      for (const change of result.changes) {
        const icon = change.action === 'removed' ? chalk.red('-') : chalk.yellow('!');
        console.log(`  ${icon} ${change.key}: ${change.reason}`);
      }
      console.log('');

      if (options.dryRun) {
        console.log(chalk.dim(`Dry run: ${removed} removal(s), ${warnings} warning(s). No changes written.`));
      } else if (removed === 0) {
        console.log(chalk.yellow(`Verification completed with ${warnings} warning(s). No changes written.`));
      } else {
        await writeState(stateDir, group, state, accessOpts);
        console.log(chalk.green(`Refreshed: ${removed} removed, ${warnings} warning(s).`));
      }
    });

  // ── state sync ──────────────────────────────────────────────────────────────
  stateCmd
    .command('sync')
    .description('Synchronise local file state with remote API state')
    .option('--group <name>', 'Group name', 'default')
    .option('--json', 'Output as JSON')
    .action(async (options: { group: string; json?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);

      const result = await syncState(stateDir, group);

      if (options.json) {
        printJson(result);
        return;
      }

      switch (result.action) {
        case 'no-api':
          console.log(chalk.dim(result.message));
          break;
        case 'already-in-sync':
          console.log(chalk.green(result.message));
          break;
        case 'local-updated':
          console.log(chalk.cyan(result.message));
          break;
        case 'remote-updated':
          console.log(chalk.cyan(result.message));
          break;
        case 'no-remote':
          console.log(chalk.yellow(result.message));
          break;
        case 'no-local':
          console.log(chalk.yellow(result.message));
          break;
        default:
          console.log(result.message);
      }
    });
}
