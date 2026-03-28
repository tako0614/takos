/**
 * Config inference & resolution: inferring R2 buckets, D1 database IDs,
 * account IDs from wrangler.toml, and resolving global CLI options.
 */

import type { DeployEnvironment, GlobalOptions, ResolvedConfig } from './admin-types.ts';
import { fail, takeFlag, takeOption } from './cli-utils.ts';
import { parseTomlPrimitive, readTomlArraySections, readTomlSection, readWranglerToml } from './toml.ts';
import { normalizePrefix } from './validation.ts';

// ---------------------------------------------------------------------------
// Config inference helpers
// ---------------------------------------------------------------------------

export function inferDefaultR2Buckets(environment: DeployEnvironment): Record<string, string> {
  const suffix = environment === 'staging' ? '-staging' : '';
  return {
    bundles: `takos-worker-bundles${suffix}`,
    builds: `takos-tenant-builds${suffix}`,
    source: `takos-tenant-source${suffix}`,
    git: `takos-git-objects${suffix}`,
    offload: `takos-offload${suffix}`,
  };
}

export function inferR2BucketAliases(
  environment: DeployEnvironment,
  wranglerToml: string | null,
): Record<string, string> {
  const aliases = inferDefaultR2Buckets(environment);

  if (!wranglerToml) {
    return aliases;
  }

  const envPrefix = environment === 'production' ? 'env.production' : 'env.staging';
  const envEntries = readTomlArraySections(wranglerToml, `${envPrefix}.r2_buckets`);
  const rootEntries = readTomlArraySections(wranglerToml, 'r2_buckets');
  const entries = envEntries.length > 0 ? envEntries : rootEntries;

  for (const entry of entries) {
    const bucketName = entry.bucket_name;
    const binding = entry.binding;
    if (!bucketName) {
      continue;
    }

    aliases[bucketName] = bucketName;

    if (binding) {
      aliases[binding.toLowerCase()] = bucketName;
      switch (binding) {
        case 'WORKER_BUNDLES':
          aliases.bundles = bucketName;
          break;
        case 'TENANT_BUILDS':
          aliases.builds = bucketName;
          break;
        case 'TENANT_SOURCE':
          aliases.source = bucketName;
          break;
        case 'GIT_OBJECTS':
          aliases.git = bucketName;
          break;
        case 'TAKOS_OFFLOAD':
          aliases.offload = bucketName;
          break;
        default:
          break;
      }
    }
  }

  return aliases;
}

export function inferD1DatabaseId(
  environment: DeployEnvironment,
  wranglerToml: string | null,
): string | undefined {
  if (!wranglerToml) {
    return undefined;
  }

  const envPrefix = environment === 'production' ? 'env.production' : 'env.staging';
  const envEntries = readTomlArraySections(wranglerToml, `${envPrefix}.d1_databases`);
  const rootEntries = readTomlArraySections(wranglerToml, 'd1_databases');
  const entries = envEntries.length > 0 ? envEntries : rootEntries;

  const dbEntry = entries.find((entry) => entry.binding === 'DB') || entries[0];
  return dbEntry?.database_id;
}

export function inferAccountId(
  environment: DeployEnvironment,
  wranglerToml: string | null,
): string | undefined {
  if (!wranglerToml) {
    return undefined;
  }

  const envPrefix = environment === 'production' ? 'env.production' : 'env.staging';
  const varsSection = readTomlSection(wranglerToml, `${envPrefix}.vars`) || readTomlSection(wranglerToml, 'vars');
  if (varsSection?.CF_ACCOUNT_ID) {
    return varsSection.CF_ACCOUNT_ID;
  }

  const accountIdMatch = wranglerToml.match(/^\s*account_id\s*=\s*(.+)$/m);
  if (!accountIdMatch) {
    return undefined;
  }

  return parseTomlPrimitive(accountIdMatch[1]);
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export function resolveEnvironment(args: string[]): DeployEnvironment {
  const envOption = takeOption(args, '--env');
  const hasStaging = takeFlag(args, '--staging');
  const hasRemote = takeFlag(args, '--remote');
  const hasLocal = takeFlag(args, '--local');

  if (hasLocal) {
    fail('Local mode is not supported by admin-cli. Use Cloudflare API targets (production/staging).');
  }

  if (envOption) {
    if (envOption !== 'production' && envOption !== 'staging') {
      fail(`Unsupported --env value: ${envOption}. Use production or staging.`);
    }
    return envOption;
  }

  if (hasStaging) {
    return 'staging';
  }

  if (hasRemote) {
    return 'production';
  }

  return 'production';
}

export function parseGlobalOptions(rawArgs: string[]): { remainingArgs: string[]; options: GlobalOptions } {
  const args = [...rawArgs];

  const environment = resolveEnvironment(args);
  const isJson = takeFlag(args, '--json');
  const approvalId = takeOption(args, '--approval-id');
  const scopeWorkspaceId = takeOption(args, '--scope-workspace-id');
  const scopeUserId = takeOption(args, '--scope-user-id');
  const scopeR2Prefix = normalizePrefix(takeOption(args, '--scope-r2-prefix'));

  const accountIdOverride = takeOption(args, '--account-id');
  const apiTokenOverride = takeOption(args, '--api-token');
  const databaseIdOverride = takeOption(args, '--database-id');

  return {
    remainingArgs: args,
    options: {
      environment,
      isJson,
      approvalId,
      scopeWorkspaceId,
      scopeUserId,
      scopeR2Prefix,
      accountIdOverride,
      apiTokenOverride,
      databaseIdOverride,
    },
  };
}

export function resolveConfig(options: GlobalOptions): ResolvedConfig {
  const wranglerToml = readWranglerToml();
  // Canonical env var: CLOUDFLARE_ACCOUNT_ID
  // CF_ACCOUNT_ID is deprecated but kept as a fallback for backward compatibility.
  const accountId =
    options.accountIdOverride ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.CF_ACCOUNT_ID ||
    inferAccountId(options.environment, wranglerToml);

  // Canonical env var: CLOUDFLARE_API_TOKEN
  // CF_API_TOKEN is deprecated but kept as a fallback for backward compatibility.
  const apiToken =
    options.apiTokenOverride ||
    process.env.CLOUDFLARE_API_TOKEN ||
    process.env.CF_API_TOKEN;

  const d1DatabaseId =
    options.databaseIdOverride ||
    process.env.TAKOS_D1_DATABASE_ID ||
    inferD1DatabaseId(options.environment, wranglerToml);

  if (!accountId) {
    fail('CLOUDFLARE_ACCOUNT_ID is required (env var, --account-id, or wrangler.toml).');
  }

  if (!apiToken) {
    fail('CLOUDFLARE_API_TOKEN is required (env var or --api-token).');
  }

  return {
    environment: options.environment,
    accountId,
    apiToken,
    d1DatabaseId,
    r2Buckets: inferR2BucketAliases(options.environment, wranglerToml),
  };
}
