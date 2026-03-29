/**
 * CLI command: `takos plan`
 *
 * Compute and display the diff between the desired state (app.yml)
 * and the current state (state.json). Does not apply any changes.
 *
 * Usage:
 *   takos plan
 *   takos plan --manifest .takos/app.yml --env staging
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { loadAppManifest, resolveAppManifestPath } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { readState, getStateDir } from '../lib/state/state-file.js';
import { computeDiff } from '../lib/state/diff.js';
import { formatPlan } from '../lib/state/plan.js';
import type { TakosState } from '../lib/state/state-types.js';

type PlanCommandOptions = {
  manifest?: string;
  env: string;
  group: string;
  offline?: boolean;
};

export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('Show execution plan: diff between app.yml and current state')
    .option('--manifest <path>', 'Path to app manifest', '.takos/app.yml')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--group <name>', 'Target group (default: "default")', 'default')
    .option('--offline', 'Force file-based state (skip API)')
    .action(async (options: PlanCommandOptions) => {
      // Step 1: Load manifest
      let manifestPath: string;
      try {
        manifestPath = options.manifest && options.manifest !== '.takos/app.yml'
          ? options.manifest
          : await resolveAppManifestPath(process.cwd());
      } catch {
        console.log(chalk.red('No .takos/app.yml found. Specify --manifest or run from a project root.'));
        cliExit(1);
      }

      let manifest;
      try {
        manifest = await loadAppManifest(manifestPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`Invalid manifest: ${message}`));
        cliExit(1);
      }

      // Step 2: Read current state (null if not found)
      const group = options.group;
      const accessOpts = options.offline ? { offline: true as const } : {};
      let currentState: TakosState | null = null;
      try {
        currentState = await readState(getStateDir(process.cwd()), group, accessOpts);
      } catch {
        // No state yet -- treat as fresh deployment
      }

      // Step 3: Compute diff
      const diff = computeDiff(manifest, currentState);

      // Step 4: Display plan
      console.log('');
      console.log(chalk.bold(`Plan: ${manifest.metadata.name}`));
      console.log(`  Environment: ${options.env}`);
      console.log(`  Manifest:    ${manifestPath}`);
      console.log('');

      const planOutput = formatPlan(diff);
      console.log(planOutput);

      // Step 5: Summary
      const totalChanges = diff.entries.filter(d => d.action !== 'unchanged').length;
      if (totalChanges === 0) {
        console.log(chalk.green('No changes. Infrastructure is up-to-date.'));
      } else {
        console.log(chalk.yellow(`Plan: ${totalChanges} change(s) detected.`));
        console.log(chalk.dim('Run `takos apply` to apply these changes.'));
      }
    });
}
