/**
 * CLI command: `takos apply`
 *
 * Apply changes from app.yml to the target environment.
 * Computes a diff, displays the plan, optionally prompts for
 * confirmation, then executes create/update/delete operations.
 *
 * Usage:
 *   takos apply --env staging
 *   takos apply --env production --auto-approve
 *   takos apply --env staging --target resources.db --target workers.web
 */
import { Command } from 'commander';
import path from 'node:path';
import readline from 'node:readline';
import chalk from 'chalk';
import { loadAppManifest, resolveAppManifestPath } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { readState, writeState, getStateDir, getStateFilePath } from '../lib/state/state-file.js';
import { computeDiff } from '../lib/state/diff.js';
import { formatPlan } from '../lib/state/plan.js';
import type { TakosState } from '../lib/state/state-types.js';
import type { DiffResult, DiffEntry } from '../lib/state/diff.js';
import { deployGroup } from '../lib/group-deploy/index.js';
import type { GroupDeployResult } from '../lib/group-deploy/index.js';

type ApplyCommandOptions = {
  manifest?: string;
  env: string;
  autoApprove?: boolean;
  target?: string[];
  accountId?: string;
  apiToken?: string;
  compatibilityDate?: string;
  namespace?: string;
  group?: string;
  baseDomain?: string;
};

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

function confirmPrompt(message: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} (yes/no): `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'yes' || answer.trim().toLowerCase() === 'y');
    });
  });
}

/** Filter diff entries by --target values like "resources.db", "workers.web" */
function filterDiffByTargets(diff: DiffResult, targets: string[]): DiffResult {
  if (targets.length === 0) return diff;
  const filtered = diff.entries.filter((entry: DiffEntry) => {
    const key = `${entry.category === 'resource' ? 'resources' : entry.category === 'worker' ? 'workers' : entry.category === 'container' ? 'containers' : 'services'}.${entry.name}`;
    return targets.some(target => key === target || key.endsWith(`.${target}`) || entry.name === target);
  });
  const summary = { create: 0, update: 0, delete: 0, unchanged: 0 };
  for (const entry of filtered) {
    summary[entry.action]++;
  }
  return {
    entries: filtered,
    hasChanges: summary.create > 0 || summary.update > 0 || summary.delete > 0,
    summary,
  };
}

/** Build worker/service/container filters from --target options for group-deploy */
function buildDeployFilters(targets: string[]): {
  workerFilter?: string[];
  serviceFilter?: string[];
  containerFilter?: string[];
} {
  if (targets.length === 0) return {};

  const workerFilter: string[] = [];
  const serviceFilter: string[] = [];
  const containerFilter: string[] = [];

  for (const target of targets) {
    const parts = target.split('.');
    if (parts.length === 2) {
      const [category, name] = parts;
      if (category === 'workers') workerFilter.push(name);
      else if (category === 'services') serviceFilter.push(name);
      else if (category === 'containers') containerFilter.push(name);
      // resources are handled by the provisioner, not as deploy filters
    } else {
      // Bare name -- add to all filters and let group-deploy figure it out
      workerFilter.push(target);
      serviceFilter.push(target);
      containerFilter.push(target);
    }
  }

  return {
    ...(workerFilter.length > 0 ? { workerFilter } : {}),
    ...(serviceFilter.length > 0 ? { serviceFilter } : {}),
    ...(containerFilter.length > 0 ? { containerFilter } : {}),
  };
}

function printResult(result: GroupDeployResult): void {
  console.log('');
  console.log(chalk.bold(`Apply: ${result.groupName}`));
  console.log(`  Environment: ${result.env}`);
  if (result.namespace) {
    console.log(`  Namespace:   ${result.namespace}`);
  }
  console.log('');

  if (result.resources.length > 0) {
    console.log(chalk.bold('Resources:'));
    for (const resource of result.resources) {
      const icon = resource.status === 'provisioned' ? chalk.green('+')
        : resource.status === 'exists' ? chalk.yellow('~')
        : chalk.red('!');
      const idInfo = resource.id ? chalk.dim(` (${resource.id})`) : '';
      const errorInfo = resource.error ? chalk.red(` -- ${resource.error}`) : '';
      console.log(`  ${icon} ${resource.name} [${resource.type}]${idInfo}${errorInfo}`);
    }
    console.log('');
  }

  if (result.services.length > 0) {
    console.log(chalk.bold('Services:'));
    for (const service of result.services) {
      const icon = service.status === 'deployed' ? chalk.green('+')
        : service.status === 'skipped' ? chalk.yellow('~')
        : chalk.red('!');
      const scriptInfo = service.scriptName ? chalk.dim(` -> ${service.scriptName}`) : '';
      const urlInfo = service.url ? chalk.dim(` (${service.url})`) : '';
      const errorInfo = service.error ? chalk.red(` -- ${service.error}`) : '';
      console.log(`  ${icon} ${service.name} [${service.type}]${scriptInfo}${urlInfo}${errorInfo}`);
    }
    console.log('');
  }

  if (result.bindings.length > 0) {
    console.log(chalk.bold('Bindings:'));
    for (const binding of result.bindings) {
      const icon = binding.status === 'bound' ? chalk.green('+') : chalk.red('!');
      const errorInfo = binding.error ? chalk.red(` -- ${binding.error}`) : '';
      console.log(`  ${icon} ${binding.from} -> ${binding.to} [${binding.type}]${errorInfo}`);
    }
    console.log('');
  }

  const totalServices = result.services.length;
  const deployedServices = result.services.filter(s => s.status === 'deployed').length;
  const failedServices = result.services.filter(s => s.status === 'failed').length;
  const totalResources = result.resources.length;
  const provisionedResources = result.resources.filter(r => r.status === 'provisioned').length;
  const failedResources = result.resources.filter(r => r.status === 'failed').length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Services:  ${deployedServices}/${totalServices} deployed, ${failedServices} failed`);
  console.log(`  Resources: ${provisionedResources}/${totalResources} provisioned, ${failedResources} failed`);

  if (failedServices > 0 || failedResources > 0) {
    console.log('');
    console.log(chalk.red('Some steps failed. Review errors above.'));
  } else {
    console.log('');
    console.log(chalk.green('Apply completed successfully.'));
  }
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('Apply changes from app.yml to the target environment')
    .option('--manifest <path>', 'Path to app manifest', '.takos/app.yml')
    .option('--env <env>', 'Target environment', 'staging')
    .option('--auto-approve', 'Skip interactive confirmation prompt')
    .option('--target <key...>', 'Apply only specific resources/services (e.g. resources.db, workers.web)')
    .option('--namespace <name>', 'Dispatch namespace')
    .option('--group <name>', 'Group name override')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--compatibility-date <date>', 'Worker compatibility date', '2025-01-01')
    .option('--base-domain <domain>', 'Base domain for template resolution')
    .action(async (options: ApplyCommandOptions) => {
      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

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

      // Step 2: Read current state
      const stateDir = getStateDir(process.cwd());
      const stateFilePath = getStateFilePath(process.cwd());
      let currentState: TakosState | null = null;
      try {
        currentState = await readState(stateDir);
      } catch {
        // No state file yet
      }

      // Step 3: Compute diff
      const fullDiff = computeDiff(manifest, currentState);
      const targets = options.target || [];
      const diff = filterDiffByTargets(fullDiff, targets);

      // Step 4: Display plan
      console.log('');
      console.log(chalk.bold(`Apply: ${manifest.metadata.name}`));
      console.log(`  Environment: ${options.env}`);
      console.log(`  Manifest:    ${manifestPath}`);
      if (targets.length > 0) {
        console.log(`  Targets:     ${targets.join(', ')}`);
      }
      console.log('');

      const planOutput = formatPlan(diff);
      console.log(planOutput);

      const totalChanges = diff.entries.filter(d => d.action !== 'unchanged').length;
      if (totalChanges === 0) {
        console.log(chalk.green('No changes. Infrastructure is up-to-date.'));
        return;
      }

      console.log(chalk.yellow(`${totalChanges} change(s) to apply.`));
      console.log('');

      // Step 5: Confirmation
      if (!options.autoApprove) {
        const hasDeletes = diff.entries.some(d => d.action === 'delete');
        const promptMessage = hasDeletes
          ? chalk.red.bold('This will DELETE resources. Continue?')
          : 'Do you want to apply these changes?';

        const confirmed = await confirmPrompt(promptMessage);
        if (!confirmed) {
          console.log(chalk.dim('Apply cancelled.'));
          return;
        }
      }

      // Step 6: Execute deploy via group-deploy engine
      console.log('');
      console.log(chalk.cyan('Applying changes...'));
      console.log('');

      const deployFilters = buildDeployFilters(targets);

      const result = await deployGroup({
        manifest: manifest as Parameters<typeof deployGroup>[0]['manifest'],
        env: options.env,
        namespace: options.namespace,
        groupName: options.group,
        accountId,
        apiToken,
        compatibilityDate: options.compatibilityDate,
        baseDomain: options.baseDomain,
        manifestDir: path.dirname(manifestPath),
        ...deployFilters,
      });

      // Step 7: Update state file
      try {
        const now = new Date().toISOString();
        const newState: TakosState = {
          version: 1,
          provider: 'cloudflare',
          env: options.env,
          groupName: options.group || manifest.metadata.name,
          updatedAt: now,
          resources: Object.fromEntries(
            result.resources.map(r => [r.name, {
              type: r.type,
              id: r.id ?? '',
              binding: r.name,
              createdAt: currentState?.resources?.[r.name]?.createdAt ?? now,
            }]),
          ),
          workers: Object.fromEntries(
            result.services.filter(s => s.type === 'worker').map(s => [s.name, {
              scriptName: s.scriptName ?? s.name,
              deployedAt: now,
              codeHash: '',
            }]),
          ),
          containers: Object.fromEntries(
            result.services.filter(s => s.type === 'container').map(s => [s.name, {
              deployedAt: now,
              imageHash: '',
            }]),
          ),
          services: Object.fromEntries(
            result.services.filter(s => s.type === 'service' || s.type === 'http').map(s => [s.name, {
              deployedAt: now,
              imageHash: '',
              ...(s.url ? { ipv4: s.url } : {}),
            }]),
          ),
        };
        await writeState(stateDir, newState);
        console.log(chalk.dim(`State saved to ${stateFilePath}`));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.yellow(`Warning: Failed to save state: ${message}`));
      }

      // Step 8: Display results
      printResult(result);

      const hasFailures = result.services.some(s => s.status === 'failed')
        || result.resources.some(r => r.status === 'failed');
      if (hasFailures) {
        cliExit(1);
      }
    });
}
