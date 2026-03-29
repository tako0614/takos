/**
 * CLI command: `takos route`
 *
 * View routes stored in state (recorded during apply).
 *
 * Subcommands:
 *   takos route list --group <name>     -- List routes in a group
 *   takos route show <name> --group <name>  -- Show details for a specific route
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { readState, getStateDir } from '../lib/state/state-file.js';
import { cliExit } from '../lib/command-exit.js';
import type { RouteState } from '../lib/state/state-types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

// ── Command registration ─────────────────────────────────────────────────────

export function registerRouteCommand(program: Command): void {
  const routeCmd = program
    .command('route')
    .description('View routes recorded in state');

  // ── route list ────────────────────────────────────────────────────────────
  routeCmd
    .command('list')
    .description('List all routes in a group')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: { group: string; json?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const state = await readState(stateDir, group);

      if (!state) {
        console.log(chalk.dim(`No state file found for group "${group}". Run \`takos apply\` first.`));
        return;
      }

      const routes = state.routes || {};
      const routeKeys = Object.keys(routes);

      if (options.json) {
        printJson(routes);
        return;
      }

      if (routeKeys.length === 0) {
        console.log(chalk.dim('No routes found in this group.'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`Routes (group: ${group}):`));
      for (const name of routeKeys) {
        const r: RouteState = routes[name];
        const domainLabel = r.domain ? chalk.dim(` domain=${r.domain}`) : '';
        const pathLabel = r.path ? chalk.dim(` path=${r.path}`) : '';
        const urlLabel = r.url ? chalk.dim(` url=${r.url}`) : '';
        console.log(`  ${name} -> ${r.target}${domainLabel}${pathLabel}${urlLabel}`);
      }
      console.log('');
      console.log(chalk.dim(`${routeKeys.length} route(s)`));
    });

  // ── route show ────────────────────────────────────────────────────────────
  routeCmd
    .command('show <name>')
    .description('Show details for a specific route')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--json', 'Machine-readable JSON output')
    .action(async (name: string, options: { group: string; json?: boolean }) => {
      const cwd = process.cwd();
      const group = options.group;
      const stateDir = getStateDir(cwd);
      const state = await readState(stateDir, group);

      if (!state) {
        console.log(chalk.red(`No state file found for group "${group}".`));
        cliExit(1);
        return; // unreachable
      }

      const routes = state.routes || {};
      const route = routes[name];

      if (!route) {
        console.log(chalk.red(`Route not found: ${name}`));
        console.log(chalk.dim('Use `takos route list` to see available routes.'));
        cliExit(1);
        return; // unreachable
      }

      if (options.json) {
        printJson({ name, ...route });
        return;
      }

      console.log('');
      console.log(chalk.bold(`Route: ${name}`));
      console.log(`  Target:  ${route.target}`);
      if (route.domain) {
        console.log(`  Domain:  ${route.domain}`);
      }
      if (route.path) {
        console.log(`  Path:    ${route.path}`);
      }
      if (route.url) {
        console.log(`  URL:     ${route.url}`);
      }
      console.log('');
    });
}
