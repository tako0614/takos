import { asc, eq } from "drizzle-orm";

import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import { TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH } from "@takosjp/takosumi-accounts-contract";
import {
  featuredAppCatalogConfig,
  featuredAppCatalogEntries,
  featuredAppPreinstallJobs,
} from "../../../infra/db/index.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import { FALLBACK_FEATURED_APP_CATALOG } from "./featured-app-fallback-catalog.ts";
import type {
  FeaturedAppCatalogConfigRow,
  FeaturedAppCatalogDefaults,
  FeaturedAppCatalogEntry,
  FeaturedAppCatalogEnv,
  FeaturedAppCatalogRow,
  FeaturedAppCatalogStatus,
  FeaturedAppCatalogStatusSource,
  FeaturedAppInstallConfig,
  FeaturedAppPreinstallJobsStatus,
  FeaturedAppPreinstallJobStatus,
  FeaturedAppReconcileStatus,
} from "./featured-app-catalog-types.ts";
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
} from "./featured-app-validation.ts";
import {
  clonePersistedCatalog,
  DB_CATALOG_CACHE_TTL_MS,
  featuredAppCatalogDeps,
  FeaturedAppCatalogInvalidError,
  FeaturedAppCatalogUnavailableError,
  defaultsCacheKey,
  getCatalogCacheEntry,
  normalizePreinstallJobStatus,
  type PersistedFeaturedAppCatalog,
  setCatalogCacheEntry,
} from "./featured-app-catalog-internal.ts";

export function readDefaults(
  env: FeaturedAppCatalogEnv,
): FeaturedAppCatalogDefaults {
  try {
    const ref = env.TAKOS_FEATURED_APP_REF?.trim();
    return {
      preinstall: readBool(env.TAKOS_FEATURED_APPS_PREINSTALL, false),
      ref: ref || "main",
      refFromEnv: Boolean(ref),
      refType: normalizeRefType(
        env.TAKOS_FEATURED_APP_REF_TYPE,
        "TAKOS_FEATURED_APP_REF_TYPE",
      ),
      backendName: normalizeBackend(
        env.TAKOS_FEATURED_APP_BACKEND,
        "TAKOS_FEATURED_APP_BACKEND",
      ),
      envName: env.TAKOS_FEATURED_APP_ENV?.trim() || undefined,
    };
  } catch (error) {
    throw new FeaturedAppCatalogInvalidError(
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
    throw new FeaturedAppCatalogInvalidError(
      `${field} must be an absolute HTTP URL`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FeaturedAppCatalogInvalidError(
      `${field} must use http or https`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new FeaturedAppCatalogInvalidError(
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
  } else {
    url.pathname = `${basePath}${TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH}`;
  }
  url.search = "";
  return url.toString();
}

export function resolveFeaturedAppInstallConfig(
  env: FeaturedAppCatalogEnv,
): FeaturedAppInstallConfig | null {
  const installUrl =
    readEnvString(env.TAKOS_FEATURED_APP_INSTALL_URL) ??
    readEnvString(env.TAKOS_APP_INSTALLATIONS_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL);
  const token =
    readEnvString(env.TAKOS_FEATURED_APP_INSTALL_TOKEN) ??
    readEnvString(env.TAKOS_APP_INSTALL_TOKEN) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN);
  const accountId =
    readEnvString(env.TAKOS_FEATURED_APP_INSTALL_ACCOUNT_ID) ??
    readEnvString(env.TAKOS_APP_INSTALL_ACCOUNT_ID);
  const subject =
    readEnvString(env.TAKOS_FEATURED_APP_INSTALL_SUBJECT) ??
    readEnvString(env.TAKOS_APP_INSTALL_SUBJECT) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_SUBJECT);
  const mode =
    readEnvString(env.TAKOS_FEATURED_APP_INSTALL_MODE) ??
    readEnvString(env.TAKOS_APP_INSTALL_MODE);
  const runtimeBaseUrl =
    readEnvString(env.TAKOS_FEATURED_APP_INSTALL_RUNTIME_BASE_URL) ??
    readEnvString(env.TAKOS_APP_INSTALL_RUNTIME_BASE_URL);
  const configured = Boolean(
    installUrl || token || accountId || subject || mode || runtimeBaseUrl,
  );
  if (!configured) return null;
  if (!installUrl || !token || !subject) {
    throw new FeaturedAppCatalogInvalidError(
      "Featured app Capsule install requires endpoint, token, and subject: configure TAKOS_FEATURED_APP_INSTALL_URL/TOKEN/SUBJECT, shared TAKOS_APP_INSTALLATIONS_URL/TOKEN/SUBJECT, or TAKOSUMI_ACCOUNTS_INTERNAL_URL + TAKOSUMI_ACCOUNTS_TOKEN/SUBJECT",
    );
  }
  return {
    installUrl: normalizeInstallationsUrl(
      installUrl,
      "TAKOS_FEATURED_APP_INSTALL_URL",
    ),
    token,
    subject,
    ...(accountId ? { accountId } : {}),
    ...(mode ? { mode } : {}),
    ...(runtimeBaseUrl
      ? {
          runtimeBaseUrl: normalizeHttpUrl(
            runtimeBaseUrl,
            "TAKOS_FEATURED_APP_INSTALL_RUNTIME_BASE_URL",
          ),
        }
      : {}),
  };
}

function parseOperatorCatalog(
  env: FeaturedAppCatalogEnv,
  defaults: FeaturedAppCatalogDefaults,
): FeaturedAppCatalogEntry[] | null {
  const raw = env.TAKOS_FEATURED_APP_CATALOG_JSON?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("TAKOS_FEATURED_APP_CATALOG_JSON must be an array");
  }
  return assertUniqueEntries(
    parsed.map((entry) => normalizeEntry(entry, defaults)),
  );
}

function parseOperatorRepositories(
  env: FeaturedAppCatalogEnv,
  defaults: FeaturedAppCatalogDefaults,
): FeaturedAppCatalogEntry[] | null {
  const raw = env.TAKOS_FEATURED_APP_REPOSITORIES_JSON?.trim();
  if (!raw) return null;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("TAKOS_FEATURED_APP_REPOSITORIES_JSON must be an array");
  }
  return assertUniqueEntries(
    parsed.map((entry) => normalizeRepositoryEntry(entry, defaults)),
  );
}

function parseConfiguredCatalog(
  env: FeaturedAppCatalogEnv,
  defaults: FeaturedAppCatalogDefaults,
): FeaturedAppCatalogEntry[] | null {
  try {
    return (
      parseOperatorCatalog(env, defaults) ??
      parseOperatorRepositories(env, defaults)
    );
  } catch (error) {
    throw new FeaturedAppCatalogInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

export function resolveFallbackFeaturedAppCatalog(
  _env: FeaturedAppCatalogEnv,
  _defaults: FeaturedAppCatalogDefaults,
): FeaturedAppCatalogEntry[] {
  return cloneEntries([...FALLBACK_FEATURED_APP_CATALOG]);
}

async function readPersistedFeaturedAppCatalog(
  env: FeaturedAppCatalogEnv,
  defaults: FeaturedAppCatalogDefaults,
  clock: Clock = systemClock,
): Promise<PersistedFeaturedAppCatalog> {
  const now = clock.now();
  const key = defaultsCacheKey(defaults);
  const cached = getCatalogCacheEntry(env.DB);
  if (cached?.key === key && cached.expiresAt && cached.expiresAt > now) {
    return clonePersistedCatalog(cached.catalog);
  }

  const db = featuredAppCatalogDeps.getDb(env.DB);
  let configRow: FeaturedAppCatalogConfigRow | undefined;
  try {
    configRow = await db
      .select()
      .from(featuredAppCatalogConfig)
      .where(eq(featuredAppCatalogConfig.id, "default"))
      .get();
  } catch (error) {
    throw new FeaturedAppCatalogUnavailableError(
      "featured app catalog config is unavailable",
      { cause: error },
    );
  }
  const configured = normalizeConfigRow(configRow);
  if (configured === false) {
    const catalog = { configured: false, entries: [] };
    setCatalogCacheEntry(env.DB, {
      key,
      catalog: clonePersistedCatalog(catalog),
      expiresAt: now + DB_CATALOG_CACHE_TTL_MS,
    });
    return catalog;
  }

  let rows: FeaturedAppCatalogRow[];
  try {
    rows = await db
      .select()
      .from(featuredAppCatalogEntries)
      .where(eq(featuredAppCatalogEntries.enabled, true))
      .orderBy(
        asc(featuredAppCatalogEntries.position),
        asc(featuredAppCatalogEntries.name),
      )
      .all();
  } catch (error) {
    throw new FeaturedAppCatalogUnavailableError(
      "featured app catalog entries are unavailable",
      { cause: error },
    );
  }

  let entries: FeaturedAppCatalogEntry[];
  try {
    entries = assertUniqueEntries(
      rows.map((row) => normalizeDatabaseEntry(row, defaults)),
    );
  } catch (error) {
    throw new FeaturedAppCatalogInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
  const catalog = {
    configured: configured === true || entries.length > 0,
    entries,
  };
  setCatalogCacheEntry(env.DB, {
    key,
    catalog: clonePersistedCatalog(catalog),
    expiresAt: now + DB_CATALOG_CACHE_TTL_MS,
  });
  return catalog;
}

export function resolveStaticFeaturedAppCatalog(
  env: FeaturedAppCatalogEnv,
): FeaturedAppCatalogEntry[] {
  const defaults = readDefaults(env);

  const operatorCatalog = parseConfiguredCatalog(env, defaults);
  if (operatorCatalog) return operatorCatalog;

  return resolveFallbackFeaturedAppCatalog(env, defaults);
}

/**
 * Static resolver for env-configured/default catalog. Use
 * `resolveFeaturedAppCatalogForBootstrap` when DB-managed operator
 * configuration must be considered.
 */
export const resolveFeaturedAppCatalog =
  resolveStaticFeaturedAppCatalog;

export async function resolveFeaturedAppCatalogForBootstrap(
  env: FeaturedAppCatalogEnv,
): Promise<FeaturedAppCatalogEntry[]> {
  const defaults = readDefaults(env);
  if (!defaults.preinstall) {
    return resolveFallbackFeaturedAppCatalog(env, defaults);
  }
  const operatorCatalog = parseConfiguredCatalog(env, defaults);
  if (operatorCatalog) return operatorCatalog;

  let persistedCatalog: PersistedFeaturedAppCatalog;
  try {
    persistedCatalog = await readPersistedFeaturedAppCatalog(
      env,
      defaults,
    );
  } catch (error) {
    if (!(error instanceof FeaturedAppCatalogUnavailableError)) {
      throw error;
    }
    logWarn("Falling back after featured app catalog DB read failed", {
      module: "featured_app_catalog",
      error: error.cause instanceof Error ? error.cause.message : error.message,
    });
    return resolveFallbackFeaturedAppCatalog(env, defaults);
  }
  if (persistedCatalog.configured) return persistedCatalog.entries;

  return resolveFallbackFeaturedAppCatalog(env, defaults);
}

export async function getFeaturedAppReconcileStatus(
  env: FeaturedAppCatalogEnv,
): Promise<FeaturedAppReconcileStatus> {
  const [catalog, jobs] = await Promise.all([
    resolveFeaturedAppCatalogStatus(env),
    readFeaturedAppPreinstallJobsStatus(env),
  ]);
  return { catalog, jobs };
}

async function resolveFeaturedAppCatalogStatus(
  env: FeaturedAppCatalogEnv,
): Promise<FeaturedAppCatalogStatus> {
  const defaults = readDefaults(env);
  if (!defaults.preinstall) {
    return featuredAppCatalogStatus(
      "disabled",
      defaults,
      resolveFallbackFeaturedAppCatalog(env, defaults),
    );
  }

  const catalogRaw = env.TAKOS_FEATURED_APP_CATALOG_JSON?.trim();
  const repositoriesRaw = env.TAKOS_FEATURED_APP_REPOSITORIES_JSON?.trim();
  if (catalogRaw) {
    try {
      return featuredAppCatalogStatus(
        "env_catalog",
        defaults,
        parseOperatorCatalog(env, defaults) ?? [],
      );
    } catch (error) {
      throw new FeaturedAppCatalogInvalidError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }
  if (repositoriesRaw) {
    try {
      return featuredAppCatalogStatus(
        "env_repositories",
        defaults,
        parseOperatorRepositories(env, defaults) ?? [],
      );
    } catch (error) {
      throw new FeaturedAppCatalogInvalidError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }

  let persistedCatalog: PersistedFeaturedAppCatalog;
  try {
    persistedCatalog = await readPersistedFeaturedAppCatalog(
      env,
      defaults,
    );
  } catch (error) {
    if (!(error instanceof FeaturedAppCatalogUnavailableError)) {
      throw error;
    }
    return featuredAppCatalogStatus(
      "fallback",
      defaults,
      resolveFallbackFeaturedAppCatalog(env, defaults),
    );
  }
  if (persistedCatalog.configured) {
    return featuredAppCatalogStatus(
      "db",
      defaults,
      persistedCatalog.entries,
    );
  }

  return featuredAppCatalogStatus(
    "fallback",
    defaults,
    resolveFallbackFeaturedAppCatalog(env, defaults),
  );
}

function featuredAppCatalogStatus(
  source: FeaturedAppCatalogStatusSource,
  defaults: FeaturedAppCatalogDefaults,
  entries: FeaturedAppCatalogEntry[],
): FeaturedAppCatalogStatus {
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
  FeaturedAppPreinstallJobStatus,
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

async function readFeaturedAppPreinstallJobsStatus(
  env: FeaturedAppCatalogEnv,
): Promise<FeaturedAppPreinstallJobsStatus> {
  const byStatus = emptyPreinstallJobStatusCounts();
  try {
    const rows = await featuredAppCatalogDeps
      .getDb(env.DB)
      .select()
      .from(featuredAppPreinstallJobs)
      .all();
    let latestUpdatedAt: string | null = null;
    const lastErrors: FeaturedAppPreinstallJobsStatus["lastErrors"] = [];

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
