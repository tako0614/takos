import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import { type Clock, systemClock } from "@takos/worker-platform-utils/clock";
import {
  TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTION_PLAN_RUNS_PATH,
  TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
} from "@takosjp/takosumi-accounts-contract";
import {
  featuredAppCatalogConfig,
  featuredAppCatalogEntries,
  featuredAppPreinstallJobs,
} from "../../../infra/db/index.ts";
import { D1TransactionManager } from "../../../shared/utils/db-transaction.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import type {
  FeaturedAppCatalogEntry,
  FeaturedAppCatalogEnv,
  FeaturedAppInstallConfig,
  FeaturedAppPreinstallJobRow,
  FeaturedAppPreinstallJobStatus,
  FeaturedAppPreinstallJobSummary,
} from "./featured-app-catalog-types.ts";
import {
  assertUniqueEntries,
  cloneEntries,
  normalizeEntry,
  normalizeRepositoryEntry,
} from "./featured-app-validation.ts";
import {
  DB_CATALOG_CACHE_TTL_MS,
  FEATURED_APP_PREINSTALL_LEASE_MS,
  FEATURED_APP_PREINSTALL_MAX_ATTEMPTS,
  featuredAppCatalogDeps,
  FeaturedAppCatalogInvalidError,
  FeaturedAppPreinstallConflictError,
  defaultsCacheKey,
  invalidateCatalogCache,
  isFeaturedAppCatalogInvalidError,
  normalizePreinstallJobStatus,
  runDbStatement,
  setCatalogCacheEntry,
} from "./featured-app-catalog-internal.ts";
import {
  readDefaults,
  resolveFeaturedAppCatalogForBootstrap,
  resolveFeaturedAppInstallConfig,
} from "./featured-app-resolution.ts";

function hasTransactionSupport(db: FeaturedAppCatalogEnv["DB"]): boolean {
  return (
    typeof db === "object" &&
    db !== null &&
    typeof Reflect.get(db, "prepare") === "function"
  );
}

function nextRetryAt(timestamp: string, attempts: number): string {
  const base = Date.parse(timestamp);
  const baseMs = Number.isFinite(base) ? base : Date.now();
  const delayMinutes = Math.min(
    60,
    Math.max(1, 2 ** Math.max(0, attempts - 1)),
  );
  return new Date(baseMs + delayMinutes * 60_000).toISOString();
}

function staleLeaseBefore(timestamp: string, leaseMs: number): string {
  const base = Date.parse(timestamp);
  const baseMs = Number.isFinite(base) ? base : Date.now();
  return new Date(baseMs - leaseMs).toISOString();
}

function featuredAppPreinstallJobId(spaceId: string): string {
  return `featured-app-preinstall:${spaceId}`;
}

function serializePreinstallCatalog(
  entries: FeaturedAppCatalogEntry[],
): string {
  return JSON.stringify(cloneEntries(entries));
}

function parsePreinstallCatalog(
  value: string | null | undefined,
): FeaturedAppCatalogEntry[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    return assertUniqueEntries(
      parsed.map((entry) =>
        normalizeEntry(entry, {
          preinstall: true,
          ref: "main",
          refFromEnv: false,
          refType: "branch",
        }),
      ),
    );
  } catch {
    return null;
  }
}

async function resolvePreinstallPlanForJob(
  env: FeaturedAppCatalogEnv,
  row: FeaturedAppPreinstallJobRow,
): Promise<FeaturedAppPreinstallPlan> {
  const stored = parsePreinstallCatalog(row.catalogJson);
  if (stored) {
    return {
      entries: stored.filter((entry) => entry.preinstall),
      refreshed: false,
    };
  }
  const entries = (await resolveFeaturedAppCatalogForBootstrap(env)).filter(
    (entry) => entry.preinstall,
  );
  return { entries, refreshed: true };
}

function hasKnownAffectedRowField(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const record = result as {
    changes?: unknown;
    rowsAffected?: unknown;
    meta?: { changes?: unknown } | null;
  };
  return (
    typeof record.meta?.changes === "number" ||
    typeof record.changes === "number" ||
    typeof record.rowsAffected === "number"
  );
}

function updateChanged(result: unknown): boolean {
  // When the driver does not surface any recognizable affected-row count we
  // assume the update touched a row (defensive default for unknown shapes).
  if (!hasKnownAffectedRowField(result)) return true;
  return affectedRowCount(result) > 0;
}

async function readResponseTextSnippet(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
}

async function readResponseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function endpointWithPath(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  url.pathname = path;
  url.search = "";
  return url.toString();
}

function planRunUrlFromInstallUrl(installUrl: string): string {
  const url = new URL(installUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith(TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH)) {
    return endpointWithPath(
      installUrl,
      TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTION_PLAN_RUNS_PATH,
    );
  }
  return endpointWithPath(
    installUrl,
    `${path}${TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTION_PLAN_RUNS_PATH}`,
  );
}

async function postJson(
  url: string,
  token: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await featuredAppCatalogDeps.fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const snippet = await readResponseTextSnippet(response);
    throw new Error(`${response.status} ${snippet}`);
  }
  return await readResponseJson(response);
}

function readExpectedGuard(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("featured app PlanRun response is missing expected guard");
  }
  const expected = (value as Record<string, unknown>).expected;
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) {
    throw new Error("featured app PlanRun response is missing expected guard");
  }
  return expected as Record<string, unknown>;
}

function featuredAppOpenTofuSource(entry: FeaturedAppCatalogEntry): {
  kind: "git";
  url: string;
  ref: string;
  modulePath?: string;
} {
  return {
    kind: "git",
    url: entry.repositoryUrl,
    ref: entry.ref,
    ...(entry.modulePath ? { modulePath: entry.modulePath } : {}),
  };
}

function hasFeaturedAppVariables(entry: FeaturedAppCatalogEntry): boolean {
  return Boolean(entry.variables && Object.keys(entry.variables).length > 0);
}

export async function applyFeaturedAppInstallation(
  entry: FeaturedAppCatalogEntry,
  config: FeaturedAppInstallConfig,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    subject?: string;
    mode?: string;
  },
): Promise<unknown> {
  const source = featuredAppOpenTofuSource(entry);
  const planBody: Record<string, unknown> = {
    spaceId: params.spaceId,
    source,
  };
  if (hasFeaturedAppVariables(entry)) planBody.variables = entry.variables;
  const plan = await postJson(
    planRunUrlFromInstallUrl(config.installUrl),
    config.token,
    planBody,
  ).catch((error) => {
    throw new Error(
      `featured app Capsule plan failed for ${entry.name}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  const expected = readExpectedGuard(plan);
  const mode = params.mode ?? config.mode ?? "shared-cell";
  const applyBody: Record<string, unknown> = {
    accountId: config.accountId ?? params.spaceId,
    spaceId: params.spaceId,
    createdBySubject: params.subject ?? config.subject,
    source,
    expected,
    mode,
  };
  if (config.runtimeBaseUrl) applyBody.runtimeBaseUrl = config.runtimeBaseUrl;
  if (entry.modulePath) applyBody.modulePath = entry.modulePath;
  if (hasFeaturedAppVariables(entry)) applyBody.vars = entry.variables;

  return await postJson(config.installUrl, config.token, applyBody).catch(
    (error) => {
      throw new Error(
        `featured app Capsule apply failed for ${entry.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  );
}

interface FeaturedAppPreinstallResult {
  entries: FeaturedAppCatalogEntry[];
}

interface FeaturedAppPreinstallPlan {
  entries: FeaturedAppCatalogEntry[];
  refreshed: boolean;
}

export async function saveFeaturedAppCatalogEntries(
  env: FeaturedAppCatalogEnv,
  rawEntries: unknown[],
  options: { timestamp?: string } = {},
  clock: Clock = systemClock,
): Promise<FeaturedAppCatalogEntry[]> {
  const defaults = readDefaults(env);
  let entries: FeaturedAppCatalogEntry[];
  try {
    entries = assertUniqueEntries(
      rawEntries.map((entry) => normalizeRepositoryEntry(entry, defaults)),
    );
  } catch (error) {
    throw new FeaturedAppCatalogInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
  const db = featuredAppCatalogDeps.getDb(env.DB);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const rows = entries.map((entry, index) => ({
    id: entry.name,
    name: entry.name,
    title: entry.title,
    icon: entry.icon ?? null,
    repositoryUrl: entry.repositoryUrl,
    ref: entry.ref,
    refType: entry.refType,
    preinstall: entry.preinstall,
    backendName: entry.backendName ?? null,
    envName: entry.envName ?? null,
    position: index,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  const replaceRows = async () => {
    await db.delete(featuredAppCatalogEntries).run();
    await db
      .delete(featuredAppCatalogConfig)
      .where(eq(featuredAppCatalogConfig.id, "default"))
      .run();
    await db
      .insert(featuredAppCatalogConfig)
      .values({
        id: "default",
        configured: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    if (rows.length > 0) {
      await db.insert(featuredAppCatalogEntries).values(rows).run();
    }
    await db
      .update(featuredAppPreinstallJobs)
      .set({
        status: "queued",
        nextAttemptAt: timestamp,
        lockedAt: null,
        lastError: null,
        catalogJson: null,
        expectedGroupIdsJson: null,
        applyQueuedAt: null,
        updatedAt: timestamp,
      })
      .where(eq(featuredAppPreinstallJobs.status, "blocked_by_config"))
      .run();
  };

  if (hasTransactionSupport(env.DB)) {
    const txManager = new D1TransactionManager(env.DB);
    await txManager.runInTransaction(replaceRows);
  } else {
    await replaceRows();
  }
  // Drop any stale cache entry from this isolate before re-seeding with the
  // freshly written rows. Readers that race with this write therefore never
  // see a half-updated cache state.
  invalidateCatalogCache(env.DB);
  setCatalogCacheEntry(env.DB, {
    key: defaultsCacheKey(defaults),
    catalog: { configured: true, entries: cloneEntries(entries) },
    expiresAt: clock.now() + DB_CATALOG_CACHE_TTL_MS,
  });
  return entries;
}

export async function clearFeaturedAppCatalogEntries(
  env: FeaturedAppCatalogEnv,
  options: { timestamp?: string } = {},
  clock: Clock = systemClock,
): Promise<void> {
  const db = featuredAppCatalogDeps.getDb(env.DB);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const clearRows = async () => {
    await db.delete(featuredAppCatalogEntries).run();
    await db
      .delete(featuredAppCatalogConfig)
      .where(eq(featuredAppCatalogConfig.id, "default"))
      .run();
    await db
      .insert(featuredAppCatalogConfig)
      .values({
        id: "default",
        configured: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    await db
      .update(featuredAppPreinstallJobs)
      .set({
        status: "queued",
        nextAttemptAt: timestamp,
        lockedAt: null,
        lastError: null,
        catalogJson: null,
        expectedGroupIdsJson: null,
        applyQueuedAt: null,
        updatedAt: timestamp,
      })
      .where(eq(featuredAppPreinstallJobs.status, "blocked_by_config"))
      .run();
  };

  if (hasTransactionSupport(env.DB)) {
    const txManager = new D1TransactionManager(env.DB);
    await txManager.runInTransaction(clearRows);
  } else {
    await clearRows();
  }
  // Drop any stale cache entry from this isolate before re-seeding with the
  // freshly cleared state.
  invalidateCatalogCache(env.DB);
  setCatalogCacheEntry(env.DB, {
    key: defaultsCacheKey(readDefaults(env)),
    catalog: { configured: false, entries: [] },
    expiresAt: clock.now() + DB_CATALOG_CACHE_TTL_MS,
  });
}

async function preinstallFeaturedAppsForSpaceDetailed(
  env: FeaturedAppCatalogEnv,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    subject?: string;
    timestamp?: string;
    entries?: FeaturedAppCatalogEntry[];
  },
): Promise<FeaturedAppPreinstallResult> {
  const entries =
    params.entries ??
    (await resolveFeaturedAppCatalogForBootstrap(env)).filter(
      (entry) => entry.preinstall,
    );
  if (entries.length === 0) {
    return {
      entries: [],
    };
  }

  const installed: FeaturedAppCatalogEntry[] = [];
  const installConfig = resolveFeaturedAppInstallConfig(env);
  if (!installConfig) {
    throw new FeaturedAppCatalogInvalidError(
      "Featured app preinstall requires Capsule install API config",
    );
  }

  for (const entry of entries) {
    await applyFeaturedAppInstallation(entry, installConfig, {
      spaceId: params.spaceId,
      createdByAccountId: params.createdByAccountId,
      subject: params.subject,
    });
    installed.push(entry);
  }

  return {
    entries: installed,
  };
}

export async function preinstallFeaturedAppsForSpace(
  env: FeaturedAppCatalogEnv,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    subject?: string;
    timestamp?: string;
  },
): Promise<FeaturedAppCatalogEntry[]> {
  if (!readDefaults(env).preinstall) return [];
  const result = await preinstallFeaturedAppsForSpaceDetailed(env, params);
  return result.entries;
}

export async function enqueueFeaturedAppPreinstallJob(
  env: FeaturedAppCatalogEnv,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    timestamp?: string;
  },
): Promise<string | null> {
  const db = featuredAppCatalogDeps.getDb(env.DB);
  const timestamp = params.timestamp ?? new Date().toISOString();
  const id = featuredAppPreinstallJobId(params.spaceId);
  let status: FeaturedAppPreinstallJobStatus = "queued";
  const catalogJson: string | null = null;
  let lastError: string | null = null;
  let nextAttemptAt: string | null = timestamp;

  try {
    const defaults = readDefaults(env);
    if (!defaults.preinstall) return null;
  } catch (error) {
    if (!isFeaturedAppCatalogInvalidError(error)) throw error;
    status = "blocked_by_config";
    lastError = error instanceof Error ? error.message : String(error);
    nextAttemptAt = nextRetryAt(timestamp, 1);
  }

  await runDbStatement(
    db
      .insert(featuredAppPreinstallJobs)
      .values({
        id,
        spaceId: params.spaceId,
        createdByAccountId: params.createdByAccountId ?? null,
        status,
        attempts: 0,
        nextAttemptAt,
        lockedAt: null,
        lastError,
        catalogJson,
        expectedGroupIdsJson: null,
        applyQueuedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoNothing({
        target: featuredAppPreinstallJobs.id,
      }),
  );
  return id;
}

function duePreinstallJobs(
  rows: FeaturedAppPreinstallJobRow[],
  timestamp: string,
  leaseMs: number,
): FeaturedAppPreinstallJobRow[] {
  const staleBefore = staleLeaseBefore(timestamp, leaseMs);
  return rows.filter((row) => {
    const status = normalizePreinstallJobStatus(row.status);
    if (
      status === "queued" ||
      status === "blocked_by_config" ||
      status === "paused_by_operator"
    ) {
      return !row.nextAttemptAt || row.nextAttemptAt <= timestamp;
    }
    if (status === "in_progress") {
      return Boolean(row.lockedAt && row.lockedAt <= staleBefore);
    }
    return false;
  });
}

async function claimFeaturedAppPreinstallJob(
  db: ReturnType<typeof featuredAppCatalogDeps.getDb>,
  row: FeaturedAppPreinstallJobRow,
  params: { attempts: number; timestamp: string },
): Promise<boolean> {
  const status = normalizePreinstallJobStatus(row.status);
  const lockedAtPredicate = row.lockedAt
    ? eq(featuredAppPreinstallJobs.lockedAt, row.lockedAt)
    : isNull(featuredAppPreinstallJobs.lockedAt);
  const result = await db
    .update(featuredAppPreinstallJobs)
    .set({
      status: "in_progress",
      attempts: params.attempts,
      lockedAt: params.timestamp,
      updatedAt: params.timestamp,
    })
    .where(
      and(
        eq(featuredAppPreinstallJobs.id, row.id),
        eq(featuredAppPreinstallJobs.status, status),
        lockedAtPredicate,
      ),
    )
    .run();
  return updateChanged(result);
}

export async function processFeaturedAppPreinstallJobs(
  env: FeaturedAppCatalogEnv,
  options: {
    limit?: number;
    spaceId?: string;
    timestamp?: string;
    maxAttempts?: number;
    leaseMs?: number;
  } = {},
): Promise<FeaturedAppPreinstallJobSummary> {
  const db = featuredAppCatalogDeps.getDb(env.DB);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const limit = Math.max(1, options.limit ?? 10);
  const leaseMs = Math.max(
    1,
    options.leaseMs ?? FEATURED_APP_PREINSTALL_LEASE_MS,
  );
  const staleBefore = staleLeaseBefore(timestamp, leaseMs);
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? FEATURED_APP_PREINSTALL_MAX_ATTEMPTS,
  );
  const summary: FeaturedAppPreinstallJobSummary = {
    scanned: 0,
    processed: 0,
    completed: 0,
    blocked: 0,
    paused: 0,
    requeued: 0,
    failed: 0,
  };

  const duePredicate = or(
    and(
      eq(featuredAppPreinstallJobs.status, "queued"),
      or(
        isNull(featuredAppPreinstallJobs.nextAttemptAt),
        lte(featuredAppPreinstallJobs.nextAttemptAt, timestamp),
      ),
    ),
    and(
      eq(featuredAppPreinstallJobs.status, "blocked_by_config"),
      or(
        isNull(featuredAppPreinstallJobs.nextAttemptAt),
        lte(featuredAppPreinstallJobs.nextAttemptAt, timestamp),
      ),
    ),
    and(
      eq(featuredAppPreinstallJobs.status, "paused_by_operator"),
      or(
        isNull(featuredAppPreinstallJobs.nextAttemptAt),
        lte(featuredAppPreinstallJobs.nextAttemptAt, timestamp),
      ),
    ),
    and(
      eq(featuredAppPreinstallJobs.status, "in_progress"),
      lte(featuredAppPreinstallJobs.lockedAt, staleBefore),
    ),
  );
  const wherePredicate = options.spaceId
    ? and(duePredicate, eq(featuredAppPreinstallJobs.spaceId, options.spaceId))
    : duePredicate;
  const rows = await db
    .select()
    .from(featuredAppPreinstallJobs)
    .where(wherePredicate)
    .orderBy(
      asc(featuredAppPreinstallJobs.nextAttemptAt),
      asc(featuredAppPreinstallJobs.createdAt),
    )
    .limit(limit)
    .all();
  summary.scanned = rows.length;

  for (const row of duePreinstallJobs(rows, timestamp, leaseMs)) {
    const attempts = row.attempts + 1;
    const claimed = await claimFeaturedAppPreinstallJob(db, row, {
      attempts,
      timestamp,
    });
    if (!claimed) continue;
    summary.processed += 1;

    try {
      const defaults = readDefaults(env);
      if (!defaults.preinstall) {
        await db
          .update(featuredAppPreinstallJobs)
          .set({
            status: "paused_by_operator",
            nextAttemptAt: nextRetryAt(timestamp, attempts),
            lockedAt: null,
            lastError: "featured app preinstall is disabled by operator",
            applyQueuedAt: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(featuredAppPreinstallJobs.id, row.id))
          .run();
        summary.paused += 1;
        continue;
      }
      const plan = await resolvePreinstallPlanForJob(env, row);
      await preinstallFeaturedAppsForSpaceDetailed(env, {
        spaceId: row.spaceId,
        createdByAccountId: row.createdByAccountId ?? undefined,
        timestamp,
        entries: plan.entries,
      });
      await db
        .update(featuredAppPreinstallJobs)
        .set({
          status: "completed",
          nextAttemptAt: null,
          lockedAt: null,
          lastError: null,
          catalogJson: plan.refreshed
            ? serializePreinstallCatalog(plan.entries)
            : row.catalogJson,
          expectedGroupIdsJson: null,
          applyQueuedAt: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(featuredAppPreinstallJobs.id, row.id))
        .run();
      summary.completed += 1;
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      const blockedByConfig = isFeaturedAppCatalogInvalidError(error);
      const terminal =
        error instanceof FeaturedAppPreinstallConflictError ||
        (!blockedByConfig && attempts >= maxAttempts);
      await db
        .update(featuredAppPreinstallJobs)
        .set({
          status: blockedByConfig
            ? "blocked_by_config"
            : terminal
              ? "failed"
              : "queued",
          nextAttemptAt: terminal ? null : nextRetryAt(timestamp, attempts),
          lockedAt: null,
          lastError,
          applyQueuedAt: null,
          ...(blockedByConfig
            ? {
                catalogJson: null,
                expectedGroupIdsJson: null,
              }
            : {}),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(featuredAppPreinstallJobs.id, row.id))
        .run();
      if (blockedByConfig) {
        summary.blocked += 1;
      } else if (terminal) {
        summary.failed += 1;
      } else {
        summary.requeued += 1;
      }
    }
  }

  return summary;
}
