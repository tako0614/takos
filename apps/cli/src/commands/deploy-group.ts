/**
 * CLI command: `takos deploy-group`
 *
 * Deploy an app group from .takos/app.yml directly to Cloudflare,
 * bypassing the store install flow. Provisions resources, deploys
 * workers, and wires up service bindings.
 *
 * NOTE: This command is kept for backward compatibility. For new
 * workflows, prefer `takos apply` which adds state tracking,
 * diff-based planning, and selective targeting.
 *
 * Usage:
 *   takos deploy-group --env staging --namespace takos-staging-tenants
 *   takos deploy-group --manifest .takos/app.yml --env production --dry-run
 */
import { Command } from 'commander';
import path from 'node:path';
import chalk from 'chalk';
import { loadAppManifest, resolveAppManifestPath } from '../lib/app-manifest.js';
import { cliExit } from '../lib/command-exit.js';
import { deployGroup, deployWranglerDirect } from '../lib/group-deploy/index.js';
import type { GroupDeployResult, WranglerDirectDeployResult } from '../lib/group-deploy/index.js';

type DeployGroupCommandOptions = {
  manifest?: string;
  env: string;
  namespace?: string;
  group?: string;
  dryRun?: boolean;
  accountId?: string;
  apiToken?: string;
  compatibilityDate?: string;
  json?: boolean;
  service?: string[];
  worker?: string[];
  container?: string[];
  baseDomain?: string;
  wranglerConfig?: string;
};

function resolveAccountId(override?: string): string {
  // Canonical env var: CLOUDFLARE_ACCOUNT_ID
  // CF_ACCOUNT_ID is deprecated but kept as a fallback for backward compatibility.
  const accountId = override || process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '';
  if (!accountId.trim()) {
    console.log(chalk.red('Cloudflare account ID is required.'));
    console.log(chalk.dim('Pass --account-id, or set CLOUDFLARE_ACCOUNT_ID.'));
    cliExit(1);
  }
  return accountId.trim();
}

function resolveApiToken(override?: string): string {
  // Canonical env var: CLOUDFLARE_API_TOKEN
  // CF_API_TOKEN is deprecated but kept as a fallback for backward compatibility.
  const apiToken = override || process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
  if (!apiToken.trim()) {
    console.log(chalk.red('Cloudflare API token is required.'));
    console.log(chalk.dim('Pass --api-token, or set CLOUDFLARE_API_TOKEN.'));
    cliExit(1);
  }
  return apiToken.trim();
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printResult(result: GroupDeployResult): void {
  const titlePrefix = result.dryRun ? '[DRY RUN] ' : '';

  console.log('');
  console.log(chalk.bold(`${titlePrefix}Group Deploy: ${result.groupName}`));
  console.log(`  Environment: ${result.env}`);
  if (result.namespace) {
    console.log(`  Namespace:   ${result.namespace}`);
  }
  console.log('');

  // Resources
  if (result.resources.length > 0) {
    console.log(chalk.bold('Resources:'));
    for (const resource of result.resources) {
      const icon = resource.status === 'provisioned' ? chalk.green('✓')
        : resource.status === 'exists' ? chalk.yellow('~')
        : chalk.red('✗');
      const idInfo = resource.id ? chalk.dim(` (${resource.id})`) : '';
      const errorInfo = resource.error ? chalk.red(` — ${resource.error}`) : '';
      console.log(`  ${icon} ${resource.name} [${resource.type}]${idInfo}${errorInfo}`);
    }
    console.log('');
  }

  // Services
  if (result.services.length > 0) {
    console.log(chalk.bold('Services:'));
    for (const service of result.services) {
      const icon = service.status === 'deployed' ? chalk.green('✓')
        : service.status === 'skipped' ? chalk.yellow('~')
        : chalk.red('✗');
      const scriptInfo = service.scriptName ? chalk.dim(` → ${service.scriptName}`) : '';
      const urlInfo = service.url ? chalk.dim(` (${service.url})`) : '';
      const errorInfo = service.error ? chalk.red(` — ${service.error}`) : '';
      console.log(`  ${icon} ${service.name} [${service.type}]${scriptInfo}${urlInfo}${errorInfo}`);
    }
    console.log('');
  }

  // Bindings
  if (result.bindings.length > 0) {
    console.log(chalk.bold('Bindings:'));
    for (const binding of result.bindings) {
      const icon = binding.status === 'bound' ? chalk.green('✓') : chalk.red('✗');
      const errorInfo = binding.error ? chalk.red(` — ${binding.error}`) : '';
      console.log(`  ${icon} ${binding.from} → ${binding.to} [${binding.type}]${errorInfo}`);
    }
    console.log('');
  }

  // Summary
  const totalServices = result.services.length;
  const deployedServices = result.services.filter(s => s.status === 'deployed').length;
  const failedServices = result.services.filter(s => s.status === 'failed').length;
  const skippedServices = result.services.filter(s => s.status === 'skipped').length;

  const totalResources = result.resources.length;
  const provisionedResources = result.resources.filter(r => r.status === 'provisioned').length;
  const failedResources = result.resources.filter(r => r.status === 'failed').length;

  console.log(chalk.bold('Summary:'));
  console.log(`  Services:  ${deployedServices}/${totalServices} deployed, ${failedServices} failed, ${skippedServices} skipped`);
  console.log(`  Resources: ${provisionedResources}/${totalResources} provisioned, ${failedResources} failed`);

  if (failedServices > 0 || failedResources > 0) {
    console.log('');
    console.log(chalk.red('Some steps failed. Review errors above.'));
  } else if (!result.dryRun) {
    console.log('');
    console.log(chalk.green('Group deployment completed successfully.'));
  }
}

function printWranglerDirectResult(result: WranglerDirectDeployResult): void {
  console.log('');
  console.log(chalk.bold('Wrangler Direct Deploy'));
  console.log(`  Config: ${result.configPath}`);
  console.log(`  Env:    ${result.env}`);
  if (result.namespace) {
    console.log(`  Namespace: ${result.namespace}`);
  }

  const icon = result.status === 'deployed' ? chalk.green('✓')
    : result.status === 'dry-run' ? chalk.yellow('~')
    : chalk.red('✗');
  console.log(`  Status: ${icon} ${result.status}`);

  if (result.error) {
    console.log(`  Error:  ${chalk.red(result.error)}`);
  }
  console.log('');
}

export function registerDeployGroupCommand(program: Command): void {
  program
    .command('deploy-group')
    .description('Deploy an app group from .takos/app.yml directly to Cloudflare')
    .option('--manifest <path>', 'Path to app manifest', '.takos/app.yml')
    .requiredOption('--env <env>', 'Target environment (staging/production)')
    .option('--namespace <name>', 'Dispatch namespace (omit for account top-level)')
    .option('--group <name>', 'Group name override (defaults to manifest name)')
    .option('--dry-run', 'Show what would be deployed without deploying')
    .option('--account-id <id>', 'Cloudflare account ID (or set CLOUDFLARE_ACCOUNT_ID)')
    .option('--api-token <token>', 'Cloudflare API token (or set CLOUDFLARE_API_TOKEN)')
    .option('--compatibility-date <date>', 'Worker compatibility date', '2025-01-01')
    .option('--service <name...>', 'Deploy only specific services (repeatable)')
    .option('--worker <name...>', 'Deploy only specific workers (repeatable)')
    .option('--container <name...>', 'Deploy only specific containers (repeatable)')
    .option('--base-domain <domain>', 'Base domain for template resolution')
    .option('--wrangler-config <path>', 'Deploy using a wrangler.toml directly')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: DeployGroupCommandOptions) => {
      const accountId = resolveAccountId(options.accountId);
      const apiToken = resolveApiToken(options.apiToken);

      // ── Validate mutual exclusivity ──────────────────────────────────
      if (options.wranglerConfig && options.manifest && options.manifest !== '.takos/app.yml') {
        console.log(chalk.red('--wrangler-config and --manifest are mutually exclusive.'));
        cliExit(1);
      }
      if (options.wranglerConfig && (options.service || options.worker || options.container)) {
        console.log(chalk.red('--wrangler-config and --service/--worker/--container are mutually exclusive.'));
        cliExit(1);
      }

      // ── Wrangler-config mode ─────────────────────────────────────────
      if (options.wranglerConfig) {
        const wranglerResult = await deployWranglerDirect({
          wranglerConfigPath: options.wranglerConfig,
          env: options.env,
          namespace: options.namespace,
          accountId,
          apiToken,
          dryRun: options.dryRun,
        });

        if (options.json) {
          printJson(wranglerResult);
          return;
        }

        printWranglerDirectResult(wranglerResult);

        if (wranglerResult.status === 'failed') {
          cliExit(1);
        }
        return;
      }

      // ── Manifest mode (default) ──────────────────────────────────────

      // Load and validate manifest
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

      // Validate filter names against manifest
      const specAny = manifest.spec as Record<string, unknown>;
      const allDeployableNames = [
        ...Object.keys((specAny.workers || {}) as Record<string, unknown>),
        ...Object.keys((specAny.containers || {}) as Record<string, unknown>),
        ...Object.keys((specAny.services || {}) as Record<string, unknown>),
      ];

      const allFilterNames = [
        ...(options.service || []),
        ...(options.worker || []),
        ...(options.container || []),
      ];
      if (allFilterNames.length > 0) {
        const unknownNames = allFilterNames.filter(s => !allDeployableNames.includes(s));
        if (unknownNames.length > 0) {
          console.log(chalk.red(`Unknown workers/containers/services: ${unknownNames.join(', ')}`));
          console.log(chalk.dim(`Available: ${allDeployableNames.join(', ')}`));
          cliExit(1);
        }
      }

      if (!options.json) {
        const modeLabel = options.dryRun ? chalk.yellow('[DRY RUN]') : chalk.cyan('[DEPLOY]');
        console.log(`${modeLabel} ${chalk.bold(manifest.metadata.name)} → ${options.env}`);
        if (options.namespace) {
          console.log(`  Namespace: ${options.namespace}`);
        }
        console.log(`  Manifest:  ${manifestPath}`);
        for (const svc of allFilterNames) {
          console.log(`  filtered: ${svc}`);
        }
        console.log('');
      }

      // Run the deploy
      const result = await deployGroup({
        manifest: manifest as Parameters<typeof deployGroup>[0]['manifest'],
        env: options.env,
        namespace: options.namespace,
        groupName: options.group,
        accountId,
        apiToken,
        dryRun: options.dryRun,
        compatibilityDate: options.compatibilityDate,
        serviceFilter: options.service,
        workerFilter: options.worker,
        containerFilter: options.container,
        baseDomain: options.baseDomain,
        manifestDir: path.dirname(manifestPath),
      });

      if (options.json) {
        printJson(result);
        return;
      }

      printResult(result);

      // Exit with error code if any service failed
      const hasFailures = result.services.some(s => s.status === 'failed')
        || result.resources.some(r => r.status === 'failed');
      if (hasFailures) {
        cliExit(1);
      }
    });
}
