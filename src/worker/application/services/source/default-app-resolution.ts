import { asc, eq } from "drizzle-orm";

import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import { TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH } from "@takosjp/takosumi-accounts-contract";
import {
  defaultAppDistributionConfig,
  defaultAppDistributionEntries,
  defaultAppPreinstallJobs,
} from "../../../infra/db/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { FALLBACK_DEFAULT_APP_DISTRIBUTION } from "./default-app-fallback-catalog.ts";
import type {
  DefaultAppDistributionConfigRow,
  DefaultAppDistributionDefaults,
  DefaultAppDistributionEntry,
  DefaultAppDistributionEnv,
  DefaultAppDistributionRow,
  DefaultAppDistributionStatus,
  DefaultAppDistributionStatusSource,
  DefaultAppInstallConfig,
  DefaultAppPreinstallJobsStatus,
  DefaultAppPreinstallJobStatus,
  DefaultAppReconcileStatus,
} from "./default-app-distribution-types.ts";
import {
  assertUniqueEntries,
  cloneEntries,
  normalizeBackend,
  normalizeConfigRow,
  normalizeDatabaseEntry,
  normalizeEntry,
  normalizeRefType,
  normalizeRepositoryEntry,
  readBool,
  readEnvString,
} from "./default-app-validation.ts";
import {
  clonePersistedDistribution,
  DB_DISTRIBUTION_CACHE_TTL_MS,
  defaultAppDistributionDeps,
  DefaultAppDistributionInvalidError,
  DefaultAppDistributionUnavailableError,
  defaultsCacheKey,
  getDistributionCacheEntry,
  normalizePreinstallJobStatus,
  type PersistedDefaultAppDistribution,
  setDistributionCacheEntry,
} from "./default-app-distribution-internal.ts";

const LEGACY_ACCOUNTS_INSTALLATION_PROJECTIONS_PATH =
  "/v1/installation-projections";

export function readDefaults(
  env: DefaultAppDistributionEnv,
): DefaultAppDistributionDefaults {
  try {
    const ref = env.TAKOS_DEFAULT_APP_REF?.trim();
    return {
      preinstall: readBool(env.TAKOS_DEFAULT_APPS_PREINSTALL, true),
      ref: ref || "main",
      refFromEnv: Boolean(ref),
      refType: normalizeRefType(
        env.TAKOS_DEFAULT_APP_REF_TYPE,
        "TAKOS_DEFAULT_APP_REF_TYPE",
      ),
      backendName: normalizeBackend(
        env.TAKOS_DEFAULT_APP_BACKEND,
        "TAKOS_DEFAULT_APP_BACKEND",
      ),
      envName: env.TAKOS_DEFAULT_APP_ENV?.trim() || undefined,
    };
  } catch (error) {
    throw new DefaultAppDistributionInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

function normalizeHttpUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DefaultAppDistributionInvalidError(
      `${field} must be an absolute HTTP URL`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new DefaultAppDistributionInvalidError(
      `${field} must use http or https`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new DefaultAppDistributionInvalidError(
      `${field} must not include credentials`,
    );
  }
  return parsed.toString();
}

function normalizeInstallationsUrl(value: string, field: string): string {
  const normalized = normalizeHttpUrl(value, field);
  const url = new URL(normalized);
  const basePath = url.pathname.replace(/\/+$/, "");
  if (basePath.endsWith(TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH)) {
    url.pathname = basePath;
  } else if (basePath.endsWith(LEGACY_ACCOUNTS_INSTALLATION_PROJECTIONS_PATH)) {
    url.pathname = `${basePath.slice(
      0,
      -LEGACY_ACCOUNTS_INSTALLATION_PROJECTIONS_PATH.length,
    )}${TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH}`;
  } else {
    url.pathname = `${basePath}${TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH}`;
  }
  url.search = "";
  return url.toString();
}

export function resolveDefaultAppInstallConfig(
  env: DefaultAppDistributionEnv,
): DefaultAppInstallConfig | null {
  const installUrl =
    readEnvString(env.TAKOS_DEFAULT_APP_INSTALL_URL) ??
    readEnvString(env.TAKOS_APP_INSTALLATIONS_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL);
  const token =
    readEnvString(env.TAKOS_DEFAULT_APP_INSTALL_TOKEN) ??
    readEnvString(env.TAKOS_APP_INSTALL_TOKEN) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN);
  const accountId =
    readEnvString(env.TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID) ??
    readEnvString(env.TAKOS_APP_INSTALL_ACCOUNT_ID);
  const subject =
    readEnvString(env.TAKOS_DEFAULT_APP_INSTALL_SUBJECT) ??
    readEnvString(env.TAKOS_APP_INSTALL_SUBJECT) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_SUBJECT);
  const mode =
    readEnvString(env.TAKOS_DEFAULT_APP_INSTALL_MODE) ??
    readEnvString(env.TAKOS_APP_INSTALL_MODE);
  const runtimeBaseUrl =
    readEnvString(env.TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL) ??
    readEnvString(env.TAKOS_APP_INSTALL_RUNTIME_BASE_URL);
  const configured = Boolean(
    installUrl || token || accountId || subject || mode || runtimeBaseUrl,
  );
  if (!configured) return null;
  if (!installUrl || !token || !subject) {
    throw new DefaultAppDistributionInvalidError(
      "Default app Capsule install requires endpoint, token, and subject: configure TAKOS_DEFAULT_APP_INSTALL_URL/TOKEN/SUBJECT, shared TAKOS_APP_INSTALLATIONS_URL/TOKEN/SUBJECT, or TAKOSUMI_ACCOUNTS_INTERNAL_URL + TAKOSUMI_ACCOUNTS_TOKEN/SUBJECT",
    );
  }
  return {
    installUrl: normalizeInstallationsUrl(
      installUrl,
      "TAKOS_DEFAULT_APP_INSTALL_URL",
    ),
    token,
    subject,
    ...(accountId ? { accountId } : {}),
    ...(mode ? { mode } : {}),
    ...(runtimeBaseUrl
      ? {
          runtimeBaseUrl: normalizeHttpUrl(
            runtimeBaseUrl,
            "TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL",
          ),
        }
      : {}),
  };
}

function parseOperatorDistribution(
  env: DefaultAppDistributionEnv,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry[] | null {
  const raw = env.TAKOS_DEFAULT_APP_DISTRIBUTION_JSON?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("TAKOS_DEFAULT_APP_DISTRIBUTION_JSON must be an array");
  }
  return assertUniqueEntries(
    parsed.map((entry) => normalizeEntry(entry, defaults)),
  );
}

function parseOperatorRepositories(
  env: DefaultAppDistributionEnv,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry[] | null {
  const raw = env.TAKOS_DEFAULT_APP_REPOSITORIES_JSON?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("TAKOS_DEFAULT_APP_REPOSITORIES_JSON must be an array");
  }
  return assertUniqueEntries(
    parsed.map((entry) => normalizeRepositoryEntry(entry, defaults)),
  );
}

function parseConfiguredDistribution(
  env: DefaultAppDistributionEnv,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry[] | null {
  try {
    return (
      parseOperatorDistribution(env, defaults) ??
      parseOperatorRepositories(env, defaults)
    );
  } catch (error) {
    throw new DefaultAppDistributionInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

export function resolveFallbackDefaultAppDistribution(
  env: DefaultAppDistributionEnv,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry[] {
  return assertUniqueEntries(
    FALLBACK_DEFAULT_APP_DISTRIBUTION.map((entry) => {
      const repositoryOverride = Reflect.get(env, entry.repositoryEnvKey);
      const modulePath = Reflect.get(entry, "modulePath");
      const variables = Reflect.get(entry, "variables");
      return normalizeEntry(
        {
          name: entry.name,
          title: entry.title,
          appId: entry.appId,
          description: entry.description,
          publisher: entry.publisher,
          homepage: entry.homepage,
          icon: entry.icon,
          category: entry.category,
          tags: entry.tags,
          repositoryUrl:
            typeof repositoryOverride === "string" && repositoryOverride.trim()
              ? repositoryOverride.trim()
              : entry.repositoryUrl,
          ref: defaults.refFromEnv ? defaults.ref : entry.ref,
          refType: defaults.refFromEnv ? defaults.refType : entry.refType,
          sourcePath: entry.sourcePath,
          ...(typeof modulePath === "string" ? { modulePath } : {}),
          ...(variables && typeof variables === "object" ? { variables } : {}),
          runtimeModes: entry.runtimeModes,
          bindings: entry.bindings,
          preinstall: "preinstall" in entry ? entry.preinstall : undefined,
        },
        defaults,
      );
    }),
  );
}

async function readPersistedDefaultAppDistribution(
  env: DefaultAppDistributionEnv,
  defaults: DefaultAppDistributionDefaults,
  clock: Clock = systemClock,
): Promise<PersistedDefaultAppDistribution> {
  const now = clock.now();
  const key = defaultsCacheKey(defaults);
  const cached = getDistributionCacheEntry(env.DB);
  if (cached?.key === key && cached.expiresAt && cached.expiresAt > now) {
    return clonePersistedDistribution(cached.distribution);
  }

  const db = defaultAppDistributionDeps.getDb(env.DB);
  let configRow: DefaultAppDistributionConfigRow | undefined;
  try {
    configRow = await db
      .select()
      .from(defaultAppDistributionConfig)
      .where(eq(defaultAppDistributionConfig.id, "default"))
      .get();
  } catch (error) {
    throw new DefaultAppDistributionUnavailableError(
      "default app distribution config is unavailable",
      { cause: error },
    );
  }
  const configured = normalizeConfigRow(configRow);
  if (configured === false) {
    const distribution = { configured: false, entries: [] };
    setDistributionCacheEntry(env.DB, {
      key,
      distribution: clonePersistedDistribution(distribution),
      expiresAt: now + DB_DISTRIBUTION_CACHE_TTL_MS,
    });
    return distribution;
  }

  let rows: DefaultAppDistributionRow[];
  try {
    rows = await db
      .select()
      .from(defaultAppDistributionEntries)
      .where(eq(defaultAppDistributionEntries.enabled, true))
      .orderBy(
        asc(defaultAppDistributionEntries.position),
        asc(defaultAppDistributionEntries.name),
      )
      .all();
  } catch (error) {
    throw new DefaultAppDistributionUnavailableError(
      "default app distribution entries are unavailable",
      { cause: error },
    );
  }

  let entries: DefaultAppDistributionEntry[];
  try {
    entries = assertUniqueEntries(
      rows.map((row) => normalizeDatabaseEntry(row, defaults)),
    );
  } catch (error) {
    throw new DefaultAppDistributionInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
  const distribution = {
    configured: configured === true || entries.length > 0,
    entries,
  };
  setDistributionCacheEntry(env.DB, {
    key,
    distribution: clonePersistedDistribution(distribution),
    expiresAt: now + DB_DISTRIBUTION_CACHE_TTL_MS,
  });
  return distribution;
}

export function resolveStaticDefaultAppDistribution(
  env: DefaultAppDistributionEnv,
): DefaultAppDistributionEntry[] {
  const defaults = readDefaults(env);

  const operatorDistribution = parseConfiguredDistribution(env, defaults);
  if (operatorDistribution) return operatorDistribution;

  return resolveFallbackDefaultAppDistribution(env, defaults);
}

/**
 * Static resolver for env-configured/default distribution. Use
 * `resolveDefaultAppDistributionForBootstrap` when DB-managed operator
 * configuration must be considered.
 */
export const resolveDefaultAppDistribution =
  resolveStaticDefaultAppDistribution;

export async function resolveDefaultAppDistributionForBootstrap(
  env: DefaultAppDistributionEnv,
): Promise<DefaultAppDistributionEntry[]> {
  const defaults = readDefaults(env);
  if (!defaults.preinstall) {
    return resolveFallbackDefaultAppDistribution(env, defaults);
  }
  const operatorDistribution = parseConfiguredDistribution(env, defaults);
  if (operatorDistribution) return operatorDistribution;

  let persistedDistribution: PersistedDefaultAppDistribution;
  try {
    persistedDistribution = await readPersistedDefaultAppDistribution(
      env,
      defaults,
    );
  } catch (error) {
    if (!(error instanceof DefaultAppDistributionUnavailableError)) {
      throw error;
    }
    logWarn("Falling back after default app distribution DB read failed", {
      module: "default_app_distribution",
      error: error.cause instanceof Error ? error.cause.message : error.message,
    });
    return resolveFallbackDefaultAppDistribution(env, defaults);
  }
  if (persistedDistribution.configured) return persistedDistribution.entries;

  return resolveFallbackDefaultAppDistribution(env, defaults);
}

export async function getDefaultAppReconcileStatus(
  env: DefaultAppDistributionEnv,
): Promise<DefaultAppReconcileStatus> {
  const [distribution, jobs] = await Promise.all([
    resolveDefaultAppDistributionStatus(env),
    readDefaultAppPreinstallJobsStatus(env),
  ]);
  return { distribution, jobs };
}

async function resolveDefaultAppDistributionStatus(
  env: DefaultAppDistributionEnv,
): Promise<DefaultAppDistributionStatus> {
  const defaults = readDefaults(env);
  if (!defaults.preinstall) {
    return defaultAppDistributionStatus(
      "disabled",
      defaults,
      resolveFallbackDefaultAppDistribution(env, defaults),
    );
  }

  const distributionRaw = env.TAKOS_DEFAULT_APP_DISTRIBUTION_JSON?.trim();
  const repositoriesRaw = env.TAKOS_DEFAULT_APP_REPOSITORIES_JSON?.trim();
  if (distributionRaw) {
    try {
      return defaultAppDistributionStatus(
        "env_distribution",
        defaults,
        parseOperatorDistribution(env, defaults) ?? [],
      );
    } catch (error) {
      throw new DefaultAppDistributionInvalidError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }
  if (repositoriesRaw) {
    try {
      return defaultAppDistributionStatus(
        "env_repositories",
        defaults,
        parseOperatorRepositories(env, defaults) ?? [],
      );
    } catch (error) {
      throw new DefaultAppDistributionInvalidError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  let persistedDistribution: PersistedDefaultAppDistribution;
  try {
    persistedDistribution = await readPersistedDefaultAppDistribution(
      env,
      defaults,
    );
  } catch (error) {
    if (!(error instanceof DefaultAppDistributionUnavailableError)) {
      throw error;
    }
    return defaultAppDistributionStatus(
      "fallback",
      defaults,
      resolveFallbackDefaultAppDistribution(env, defaults),
    );
  }
  if (persistedDistribution.configured) {
    return defaultAppDistributionStatus(
      "db",
      defaults,
      persistedDistribution.entries,
    );
  }

  return defaultAppDistributionStatus(
    "fallback",
    defaults,
    resolveFallbackDefaultAppDistribution(env, defaults),
  );
}

function defaultAppDistributionStatus(
  source: DefaultAppDistributionStatusSource,
  defaults: DefaultAppDistributionDefaults,
  entries: DefaultAppDistributionEntry[],
): DefaultAppDistributionStatus {
  const cloned = cloneEntries(entries);
  return {
    source,
    preinstallEnabled: defaults.preinstall,
    entries: cloned,
    totalEntries: cloned.length,
    preinstallEntries: cloned.filter((entry) => entry.preinstall).length,
  };
}

function emptyPreinstallJobStatusCounts(): Record<
  DefaultAppPreinstallJobStatus,
  number
> {
  return {
    queued: 0,
    in_progress: 0,
    blocked_by_config: 0,
    paused_by_operator: 0,
    completed: 0,
    failed: 0,
  };
}

async function readDefaultAppPreinstallJobsStatus(
  env: DefaultAppDistributionEnv,
): Promise<DefaultAppPreinstallJobsStatus> {
  const byStatus = emptyPreinstallJobStatusCounts();
  try {
    const rows = await defaultAppDistributionDeps
      .getDb(env.DB)
      .select()
      .from(defaultAppPreinstallJobs)
      .all();
    let latestUpdatedAt: string | null = null;
    const lastErrors: DefaultAppPreinstallJobsStatus["lastErrors"] = [];

    for (const row of rows) {
      const status = normalizePreinstallJobStatus(row.status);
      byStatus[status] += 1;
      if (
        row.updatedAt &&
        (!latestUpdatedAt || row.updatedAt > latestUpdatedAt)
      ) {
        latestUpdatedAt = row.updatedAt;
      }
      if (row.lastError) {
        lastErrors.push({
          id: row.id,
          spaceId: row.spaceId,
          status,
          lastError: row.lastError,
          updatedAt: row.updatedAt,
        });
      }
    }

    lastErrors.sort((left, right) =>
      String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
    );
    return {
      available: true,
      total: rows.length,
      byStatus,
      latestUpdatedAt,
      lastErrors: lastErrors.slice(0, 10),
    };
  } catch (error) {
    return {
      available: false,
      total: 0,
      byStatus,
      latestUpdatedAt: null,
      lastErrors: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
