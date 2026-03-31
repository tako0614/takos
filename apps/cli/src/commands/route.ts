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
import { bold, dim, red } from '@std/fmt/colors';
import { readState, getStateDir } from '../lib/state/state-file.ts';
import { cliExit } from '../lib/command-exit.ts';
import { printJson } from '../lib/cli-utils.ts';
import type { RouteState } from '../lib/state/state-types.ts';

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
        console.log(dim(`No state file found for group "${group}". Run \`takos apply\` first.`));
        return;
      }

      const routes = state.routes || {};
      const routeKeys = Object.keys(routes);

      if (options.json) {
        printJson(routes);
        return;
      }

      if (routeKeys.length === 0) {
        console.log(dim('No routes found in this group.'));
        return;
      }

      console.log('');
      console.log(bold(`Routes (group: ${group}):`));
      for (const name of routeKeys) {
        const r: RouteState = routes[name];
        const domainLabel = r.domain ? dim(` domain=${r.domain}`) : '';
        const pathLabel = r.path ? dim(` path=${r.path}`) : '';
        const urlLabel = r.url ? dim(` url=${r.url}`) : '';
        console.log(`  ${name} -> ${r.target}${domainLabel}${pathLabel}${urlLabel}`);
      }
      console.log('');
      console.log(dim(`${routeKeys.length} route(s)`));
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
        console.log(red(`No state file found for group "${group}".`));
        cliExit(1);
        return; // unreachable
      }

      const routes = state.routes || {};
      const route = routes[name];

      if (!route) {
        console.log(red(`Route not found: ${name}`));
        console.log(dim('Use `takos route list` to see available routes.'));
        cliExit(1);
        return; // unreachable
      }

      if (options.json) {
        printJson({ name, ...route });
        return;
      }

      console.log('');
      console.log(bold(`Route: ${name}`));
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
