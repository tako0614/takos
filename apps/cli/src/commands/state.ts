/**
 * CLI command: `takos state`
 *
 * Manage the local state file (.takos/state.json).
 *
 * Subcommands:
 *   takos state list                      -- Show all tracked resources/services
 *   takos state show <key>                -- Show details for a specific entry
 *   takos state import <key> <id>         -- Import an existing resource into state
 *   takos state rm <key>                  -- Remove entry from state (does NOT delete the actual resource)
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readState, writeState, getStateDir, getStateFilePath } from '../lib/state/state-file.js';
import { cliExit } from '../lib/command-exit.js';
import type { TakosState } from '../lib/state/state-types.js';

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

type StateCategory = 'resources' | 'workers' | 'containers' | 'services';

/**
 * Resolve a dotted key like "resources.db" or "services.web" against
 * the TakosState structure. Returns { category, name, entry } or null.
 */
function resolveStateKey(state: TakosState, key: string): {
  category: StateCategory;
  name: string;
  entry: Record<string, unknown>;
} | null {
  const categories: StateCategory[] = ['resources', 'workers', 'containers', 'services'];
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

export function registerStateCommand(program: Command): void {
  const stateCmd = program
    .command('state')
    .description('Manage local state (.takos/state.json)');

  // ── state list ──────────────────────────────────────────────────────────────
  stateCmd
    .command('list')
    .description('List all tracked resources and services')
    .option('--json', 'Output as JSON')
    .action(async (options: { json?: boolean }) => {
      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const stateFilePath = getStateFilePath(cwd);
      let state: TakosState | null;
      try {
        state = await readState(stateDir);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.dim('No state file found. Run `takos apply` first.'));
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
      console.log(`  Updated at:  ${state.updatedAt || '(never)'}`);
      console.log(`  State file:  ${stateFilePath}`);
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
    .option('--json', 'Output as JSON')
    .action(async (key: string, options: { json?: boolean }) => {
      const stateDir = getStateDir(process.cwd());
      let state: TakosState | null;
      try {
        state = await readState(stateDir);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.red('No state file found. Run `takos apply` first.'));
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
    .action(async (key: string, id: string) => {
      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const stateFilePath = getStateFilePath(cwd);
      let state: TakosState | null;
      try {
        state = await readState(stateDir);
      } catch {
        state = null;
      }

      const now = new Date().toISOString();
      if (!state) {
        state = {
          version: 1,
          provider: 'cloudflare',
          env: 'unknown',
          groupName: 'unknown',
          updatedAt: now,
          resources: {},
          workers: {},
          containers: {},
          services: {},
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
      await writeState(stateDir, state);
      console.log(chalk.green(`Imported ${key} with id ${id}`));
      console.log(chalk.dim(`State saved to ${stateFilePath}`));
    });

  // ── state rm ────────────────────────────────────────────────────────────────
  stateCmd
    .command('rm <key>')
    .description('Remove an entry from state (does NOT delete the actual resource)')
    .action(async (key: string) => {
      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      let state: TakosState | null;
      try {
        state = await readState(stateDir);
      } catch {
        state = null;
      }

      if (!state) {
        console.log(chalk.red('No state file found. Nothing to remove.'));
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
      }

      await writeState(stateDir, state);
      console.log(chalk.green(`Removed ${resolved.category}.${resolved.name} from state`));
      console.log(chalk.dim('The actual resource was NOT deleted. Use provider tools to delete it.'));
    });
}
