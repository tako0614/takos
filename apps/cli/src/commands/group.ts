/**
 * CLI command: `takos group`
 *
 * Manage groups (state namespaces).
 *
 * By default state is fetched from the takos API.  When the API is
 * unavailable or `--offline` is passed, the local file backend
 * (.takos/state.*.json) is used instead.
 *
 * Subcommands:
 *   takos group list              -- List groups
 *   takos group show <name>       -- Show all entities in a group
 *   takos group delete <name>     -- Delete all entities and state for a group
 */
import { Command } from 'commander';
import chalk from 'chalk';
import {
  readState,
  getStateDir,
  getStateFilePath,
  listStateGroups,
  deleteStateFile,
} from '../lib/state/state-file.js';
import type { StateAccessOptions } from '../lib/state/state-file.js';
import { cliExit } from '../lib/command-exit.js';
import { confirmPrompt } from '../lib/cli-utils.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const GROUP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function validateGroupName(name: string): void {
  if (!GROUP_NAME_PATTERN.test(name)) {
    console.log(chalk.red(`Invalid group name: "${name}"`));
    console.log(chalk.dim('Group names must match: ^[a-z0-9][a-z0-9-]*$'));
    cliExit(1);
  }
}

function toAccessOpts(options: { offline?: boolean }): StateAccessOptions {
  return options.offline ? { offline: true } : {};
}

// ── Command registration ─────────────────────────────────────────────────────

export function registerGroupCommand(program: Command): void {
  const groupCmd = program
    .command('group')
    .description('Manage groups (state namespaces)');

  // ── group list ────────────────────────────────────────────────────────────
  groupCmd
    .command('list')
    .description('List all groups')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: { json?: boolean; offline?: boolean }) => {
      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      const groups = await listStateGroups(stateDir, accessOpts);

      if (options.json) {
        process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`);
        return;
      }

      if (groups.length === 0) {
        console.log(chalk.dim('No groups found. Run `takos apply` to create one.'));
        return;
      }

      console.log('');
      console.log(chalk.bold('Groups:'));
      for (const name of groups) {
        if (accessOpts.offline) {
          const stateFilePath = getStateFilePath(stateDir, name);
          console.log(`  ${name}  ${chalk.dim(stateFilePath)}`);
        } else {
          console.log(`  ${name}`);
        }
      }
      console.log('');
      console.log(chalk.dim(`${groups.length} group(s)`));
    });

  // ── group show ────────────────────────────────────────────────────────────
  groupCmd
    .command('show <name>')
    .description('Show all entities in a group')
    .option('--json', 'Machine-readable JSON output')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (name: string, options: { json?: boolean; offline?: boolean }) => {
      validateGroupName(name);
      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      const state = await readState(stateDir, name, accessOpts);

      if (!state) {
        console.log(chalk.red(`Group not found: ${name}`));
        console.log(chalk.dim('Use `takos group list` to see available groups.'));
        cliExit(1);
        return; // unreachable
      }

      if (options.json) {
        process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
        return;
      }

      console.log('');
      console.log(chalk.bold(`Group: ${name}`));
      console.log(`  Provider:    ${state.provider || '(unknown)'}`);
      console.log(`  Environment: ${state.env || '(unknown)'}`);
      console.log(`  Group name:  ${state.groupName || '(unknown)'}`);
      console.log(`  Updated at:  ${state.updatedAt || '(never)'}`);
      console.log('');

      const resources = state.resources || {};
      const workers = state.workers || {};
      const containers = state.containers || {};
      const services = state.services || {};
      const routes = state.routes || {};

      const resourceKeys = Object.keys(resources);
      const workerKeys = Object.keys(workers);
      const containerKeys = Object.keys(containers);
      const serviceKeys = Object.keys(services);
      const routeKeys = Object.keys(routes);

      if (resourceKeys.length > 0) {
        console.log(chalk.bold('Resources:'));
        for (const rname of resourceKeys) {
          const r = resources[rname];
          const typeLabel = r.type ? `[${r.type}]` : '';
          const idLabel = r.id ? chalk.dim(` (${r.id})`) : '';
          console.log(`  resources.${rname} ${typeLabel}${idLabel}`);
        }
        console.log('');
      }

      if (workerKeys.length > 0) {
        console.log(chalk.bold('Workers:'));
        for (const wname of workerKeys) {
          const w = workers[wname];
          const scriptLabel = w.scriptName ? chalk.dim(` -> ${w.scriptName}`) : '';
          console.log(`  workers.${wname} [worker]${scriptLabel}`);
        }
        console.log('');
      }

      if (containerKeys.length > 0) {
        console.log(chalk.bold('Containers:'));
        for (const cname of containerKeys) {
          console.log(`  containers.${cname} [container]`);
        }
        console.log('');
      }

      if (serviceKeys.length > 0) {
        console.log(chalk.bold('Services:'));
        for (const sname of serviceKeys) {
          const s = services[sname];
          const ipLabel = s.ipv4 ? chalk.dim(` (${s.ipv4})`) : '';
          console.log(`  services.${sname} [service]${ipLabel}`);
        }
        console.log('');
      }

      if (routeKeys.length > 0) {
        console.log(chalk.bold('Routes:'));
        for (const rtname of routeKeys) {
          const rt = routes[rtname];
          const domainLabel = rt.domain ? chalk.dim(` domain=${rt.domain}`) : '';
          const urlLabel = rt.url ? chalk.dim(` url=${rt.url}`) : '';
          console.log(`  routes.${rtname} -> ${rt.target}${domainLabel}${urlLabel}`);
        }
        console.log('');
      }

      const totalCount = resourceKeys.length + workerKeys.length + containerKeys.length + serviceKeys.length + routeKeys.length;
      if (totalCount === 0) {
        console.log(chalk.dim('Group is empty.'));
      }

      console.log(chalk.dim(
        `${resourceKeys.length} resource(s), ${workerKeys.length} worker(s), ` +
        `${containerKeys.length} container(s), ${serviceKeys.length} service(s), ` +
        `${routeKeys.length} route(s)`,
      ));
    });

  // ── group delete ──────────────────────────────────────────────────────────
  groupCmd
    .command('delete <name>')
    .description('Delete a group and its state')
    .option('--force', 'Skip confirmation prompt')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (name: string, options: { force?: boolean; offline?: boolean }) => {
      validateGroupName(name);
      const cwd = process.cwd();
      const stateDir = getStateDir(cwd);
      const accessOpts = toAccessOpts(options);
      const state = await readState(stateDir, name, accessOpts);

      if (!state) {
        console.log(chalk.red(`Group not found: ${name}`));
        console.log(chalk.dim('Use `takos group list` to see available groups.'));
        cliExit(1);
        return; // unreachable
      }

      const resourceCount = Object.keys(state.resources || {}).length;
      const workerCount = Object.keys(state.workers || {}).length;
      const containerCount = Object.keys(state.containers || {}).length;
      const serviceCount = Object.keys(state.services || {}).length;
      const totalCount = resourceCount + workerCount + containerCount + serviceCount;

      if (!options.force) {
        console.log('');
        console.log(chalk.bold(`Group: ${name}`));
        console.log(`  ${totalCount} entit${totalCount === 1 ? 'y' : 'ies'} will be removed from state.`);
        console.log(chalk.dim('  (Actual cloud resources will NOT be deleted.)'));
        console.log('');

        const confirmed = await confirmPrompt(chalk.red.bold('Delete this group?'));
        if (!confirmed) {
          console.log(chalk.dim('Cancelled.'));
          return;
        }
      }

      await deleteStateFile(stateDir, name, accessOpts);
      console.log(chalk.green(`Deleted group '${name}'`));
      console.log(chalk.dim('Actual cloud resources were NOT deleted.'));
    });
}
