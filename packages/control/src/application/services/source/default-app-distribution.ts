import { and, asc, eq, isNull, lte, or } from "drizzle-orm";

import {
  defaultAppDistributionConfig,
  defaultAppDistributionEntries,
  defaultAppPreinstallJobs,
  getDb,
  groupDeploymentSnapshots,
  groups,
} from "../../../infra/db/index.ts";
import {
  DEPLOYMENT_QUEUE_MESSAGE_VERSION,
  type DeploymentQueueMessage,
  type Env,
} from "../../../shared/types/index.ts";
import { D1TransactionManager } from "../../../shared/utils/db-transaction.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import {
  GROUP_NAME_REQUIREMENTS,
  isValidGroupName,
} from "../../../shared/utils/naming-utils.ts";

type DefaultAppRefType = "branch" | "tag" | "commit";
type DefaultAppBackend = "cloudflare" | "local" | "aws" | "gcp" | "k8s";

export interface DefaultAppDistributionEntry {
  name: string;
  title: string;
  icon?: string;
  repositoryUrl: string;
  ref: string;
  refType: DefaultAppRefType;
  preinstall: boolean;
  backendName?: DefaultAppBackend;
  envName?: string;
}

type DefaultAppDistributionEnv = Pick<
  Env,
  | "DB"
  | "DEPLOY_QUEUE"
  | "TAKOS_DEFAULT_APP_DISTRIBUTION_JSON"
  | "TAKOS_DEFAULT_APP_REPOSITORIES_JSON"
  | "TAKOS_DEFAULT_APPS_PREINSTALL"
  | "TAKOS_DEFAULT_APP_REF"
  | "TAKOS_DEFAULT_APP_REF_TYPE"
  | "TAKOS_DEFAULT_APP_BACKEND"
  | "TAKOS_DEFAULT_APP_ENV"
  | "TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL"
  | "TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL"
>;

type DefaultAppDistributionDefaults = {
  preinstall: boolean;
  ref: string;
  refFromEnv: boolean;
  refType: DefaultAppRefType;
  backendName?: DefaultAppBackend;
  envName?: string;
};

type DefaultAppDistributionRow =
  typeof defaultAppDistributionEntries.$inferSelect;
type DefaultAppDistributionConfigRow =
  typeof defaultAppDistributionConfig.$inferSelect;
type DefaultAppPreinstallJobRow = typeof defaultAppPreinstallJobs.$inferSelect;
type CurrentGroupDeploymentSnapshot = {
  sourceKind: string | null;
  sourceRepositoryUrl: string | null;
  sourceRef: string | null;
  sourceRefType: string | null;
  status: string | null;
};

type PersistedDefaultAppDistribution = {
  configured: boolean;
  entries: DefaultAppDistributionEntry[];
};

export type DefaultAppPreinstallJobStatus =
  | "queued"
  | "in_progress"
  | "deployment_queued"
  | "blocked_by_config"
  | "paused_by_operator"
  | "completed"
  | "failed";

export interface DefaultAppPreinstallJobSummary {
  scanned: number;
  processed: number;
  completed: number;
  deploymentQueued: number;
  blocked: number;
  paused: number;
  requeued: number;
  failed: number;
}

const FALLBACK_DEFAULT_APP_DISTRIBUTION = [
  {
    name: "takos-docs",
    title: "Docs",
    repositoryUrl: "https://github.com/tako0614/takos-docs.git",
    repositoryEnvKey: "TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL",
    ref: "master",
  },
  {
    name: "takos-excel",
    title: "Excel",
    repositoryUrl: "https://github.com/tako0614/takos-excel.git",
    repositoryEnvKey: "TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL",
    ref: "master",
  },
  {
    name: "takos-slide",
    title: "Slide",
    repositoryUrl: "https://github.com/tako0614/takos-slide.git",
    repositoryEnvKey: "TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL",
    ref: "master",
  },
  {
    name: "takos-computer",
    title: "Computer",
    repositoryUrl: "https://github.com/tako0614/takos-computer.git",
    repositoryEnvKey: "TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL",
    ref: "master",
  },
  {
    name: "yurucommu",
    title: "Yurucommu",
    repositoryUrl: "https://github.com/tako0614/yurucommu.git",
    repositoryEnvKey: "TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL",
    ref: "master",
  },
] as const;

export const defaultAppDistributionDeps = {
  getDb,
};

const DB_DISTRIBUTION_CACHE_TTL_MS = 30_000;
const DEFAULT_APP_PREINSTALL_MAX_ATTEMPTS = 8;
const DEFAULT_APP_PREINSTALL_LEASE_MS = 15 * 60_000;
const DEFAULT_APP_DEPLOYMENT_QUEUE_WATCHDOG_MS = 15 * 60_000;

class DefaultAppDistributionUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DefaultAppDistributionUnavailableError";
  }
}

class DefaultAppDistributionInvalidError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DefaultAppDistributionInvalidError";
  }
}

class DefaultAppPreinstallConflictError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "DefaultAppPreinstallConflictError";
  }
}

export function isDefaultAppDistributionInvalidError(
  error: unknown,
): boolean {
  return error instanceof DefaultAppDistributionInvalidError;
}

export function isDefaultAppDistributionConfigError(
  error: unknown,
): boolean {
  return error instanceof DefaultAppDistributionInvalidError;
}

export function hasDefaultAppDistributionEnvOverride(
  env: DefaultAppDistributionEnv,
): boolean {
  return Boolean(
    env.TAKOS_DEFAULT_APP_DISTRIBUTION_JSON?.trim() ||
      env.TAKOS_DEFAULT_APP_REPOSITORIES_JSON?.trim(),
  );
}

type PersistedDistributionCacheEntry = {
  key: string;
  distribution: PersistedDefaultAppDistribution;
  expiresAt: number;
};

let persistedDistributionCache = new WeakMap<
  object,
  PersistedDistributionCacheEntry
>();

function cloneEntries(
  entries: DefaultAppDistributionEntry[],
): DefaultAppDistributionEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

export function clearDefaultAppDistributionCache(): void {
  persistedDistributionCache = new WeakMap();
}

function defaultsCacheKey(defaults: DefaultAppDistributionDefaults): string {
  return JSON.stringify(defaults);
}

function getDistributionCacheEntry(
  dbBinding: DefaultAppDistributionEnv["DB"],
): PersistedDistributionCacheEntry | null {
  return typeof dbBinding === "object" && dbBinding !== null
    ? persistedDistributionCache.get(dbBinding) ?? null
    : null;
}

function setDistributionCacheEntry(
  dbBinding: DefaultAppDistributionEnv["DB"],
  entry: PersistedDistributionCacheEntry,
): void {
  if (typeof dbBinding === "object" && dbBinding !== null) {
    persistedDistributionCache.set(dbBinding, entry);
  }
}

async function runDbStatement(
  statement: { run?: () => Promise<unknown> },
): Promise<void> {
  if (typeof statement.run === "function") {
    await statement.run();
  } else {
    await statement;
  }
}

function clonePersistedDistribution(
  distribution: PersistedDefaultAppDistribution,
): PersistedDefaultAppDistribution {
  return {
    configured: distribution.configured,
    entries: cloneEntries(distribution.entries),
  };
}

function messageTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`boolean value is invalid: ${value}`);
}

function normalizeRefType(
  value: unknown,
  field = "refType",
): DefaultAppRefType {
  if (value === undefined || value === null || value === "") return "branch";
  if (value === "branch" || value === "tag" || value === "commit") {
    return value;
  }
  throw new Error(
    `default app distribution ${field} is invalid: ${String(value)}`,
  );
}

function normalizeBackend(
  value: unknown,
  field = "backendName",
): DefaultAppBackend | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return value === "cloudflare" || value === "local" || value === "aws" ||
      value === "gcp" || value === "k8s"
    ? value
    : (() => {
      throw new Error(
        `default app distribution ${field} is invalid: ${String(value)}`,
      );
    })();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("default app distribution entries must be objects");
  }
  return value as Record<string, unknown>;
}

function readString(
  record: Record<string, unknown>,
  field: string,
  fallback?: string,
): string {
  const value = record[field];
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized) return normalized;
  if (fallback !== undefined) return fallback;
  throw new Error(`default app distribution entry.${field} is required`);
}

function readOptionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

function assertValidGroupName(name: string): void {
  if (!isValidGroupName(name)) {
    throw new Error(
      `default app group name is invalid: ${name}; ${GROUP_NAME_REQUIREMENTS}`,
    );
  }
}

function assertValidRepositoryUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      `default app repository URL must use HTTPS: ${url}`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `default app repository URL must use HTTPS: ${url}`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error("default app repository URL must not include credentials");
  }
}

function repositoryUrlDuplicateKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  const pathname = parsed.pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
  parsed.pathname = pathname;
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

function assertUniqueEntries(
  entries: DefaultAppDistributionEntry[],
): DefaultAppDistributionEntry[] {
  const names = new Set<string>();
  const repositoryUrls = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new Error(`duplicate default app group name: ${entry.name}`);
    }
    names.add(entry.name);

    const repositoryUrl = repositoryUrlDuplicateKey(entry.repositoryUrl);
    if (repositoryUrls.has(repositoryUrl)) {
      throw new Error(
        `duplicate default app repository URL: ${entry.repositoryUrl}`,
      );
    }
    repositoryUrls.add(repositoryUrl);
  }
  return entries;
}

function groupNameFromRepositoryUrl(repositoryUrl: string): string {
  assertValidRepositoryUrl(repositoryUrl);
  const parsed = new URL(repositoryUrl);
  const lastPathPart = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const withoutGitSuffix = lastPathPart.replace(/\.git$/i, "");
  const normalized = withoutGitSuffix
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  assertValidGroupName(normalized);
  return normalized;
}

function normalizeEntry(
  raw: unknown,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry {
  const record = asRecord(raw);
  const name = readString(record, "name");
  assertValidGroupName(name);
  const repositoryUrl = readString(record, "repositoryUrl");
  assertValidRepositoryUrl(repositoryUrl);
  const title = readString(record, "title", name);
  const icon = readOptionalString(record, "icon");
  const preinstall = typeof record.preinstall === "boolean"
    ? record.preinstall
    : defaults.preinstall;
  const backendName =
    normalizeBackend(record.backendName, "entry.backendName") ??
      defaults.backendName;
  const envName = typeof record.envName === "string" && record.envName.trim()
    ? record.envName.trim()
    : defaults.envName;
  return {
    name,
    title,
    ...(icon ? { icon } : {}),
    repositoryUrl,
    ref: readString(record, "ref", defaults.ref),
    refType: normalizeRefType(
      record.refType ?? defaults.refType,
      "entry.refType",
    ),
    preinstall,
    ...(backendName ? { backendName } : {}),
    ...(envName ? { envName } : {}),
  };
}

function normalizeRepositoryEntry(
  raw: unknown,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry {
  if (typeof raw === "string") {
    const repositoryUrl = raw.trim();
    const name = groupNameFromRepositoryUrl(repositoryUrl);
    return normalizeEntry({ name, title: name, repositoryUrl }, defaults);
  }

  const record = asRecord(raw);
  const repositoryUrl = readOptionalString(record, "repositoryUrl") ??
    readOptionalString(record, "url");
  if (!repositoryUrl) {
    throw new Error("default app distribution entry.repositoryUrl is required");
  }
  const name = readOptionalString(record, "name") ??
    groupNameFromRepositoryUrl(repositoryUrl);
  return normalizeEntry({ ...record, name, repositoryUrl }, defaults);
}

function normalizeDatabaseEntry(
  row: DefaultAppDistributionRow,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry {
  return normalizeEntry(
    {
      name: row.name,
      title: row.title,
      repositoryUrl: row.repositoryUrl,
      ref: row.ref,
      refType: row.refType,
      preinstall: row.preinstall,
      ...(row.backendName ? { backendName: row.backendName } : {}),
      ...(row.envName ? { envName: row.envName } : {}),
    },
    defaults,
  );
}

function normalizeConfigRow(
  row: DefaultAppDistributionConfigRow | undefined,
): boolean | null {
  if (!row) return null;
  return row.configured;
}

function readDefaults(
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
    return parseOperatorDistribution(env, defaults) ??
      parseOperatorRepositories(env, defaults);
  } catch (error) {
    throw new DefaultAppDistributionInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
}

function resolveFallbackDefaultAppDistribution(
  env: DefaultAppDistributionEnv,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry[] {
  return assertUniqueEntries(
    FALLBACK_DEFAULT_APP_DISTRIBUTION.map((entry) => {
      const repositoryOverride = Reflect.get(env, entry.repositoryEnvKey);
      return normalizeEntry(
        {
          name: entry.name,
          title: entry.title,
          repositoryUrl: typeof repositoryOverride === "string" &&
              repositoryOverride.trim()
            ? repositoryOverride.trim()
            : entry.repositoryUrl,
          ref: defaults.refFromEnv ? defaults.ref : entry.ref,
        },
        defaults,
      );
    }),
  );
}

async function readPersistedDefaultAppDistribution(
  env: DefaultAppDistributionEnv,
  defaults: DefaultAppDistributionDefaults,
  now = Date.now(),
): Promise<PersistedDefaultAppDistribution> {
  const key = defaultsCacheKey(defaults);
  const cached = getDistributionCacheEntry(env.DB);
  if (
    cached?.key === key &&
    cached.expiresAt &&
    cached.expiresAt > now
  ) {
    return clonePersistedDistribution(cached.distribution);
  }

  const db = defaultAppDistributionDeps.getDb(env.DB);
  let configRow: DefaultAppDistributionConfigRow | undefined;
  try {
    configRow = await db.select()
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
    rows = await db.select()
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
 * Backward-compatible static resolver. Use
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

function hasTransactionSupport(
  db: DefaultAppDistributionEnv["DB"],
): boolean {
  return typeof db === "object" && db !== null &&
    typeof Reflect.get(db, "prepare") === "function";
}

function isPreinstallJobStatus(
  value: string,
): value is DefaultAppPreinstallJobStatus {
  return value === "queued" || value === "in_progress" ||
    value === "deployment_queued" || value === "blocked_by_config" ||
    value === "paused_by_operator" || value === "completed" ||
    value === "failed";
}

function normalizePreinstallJobStatus(
  value: string,
): DefaultAppPreinstallJobStatus {
  return isPreinstallJobStatus(value) ? value : "queued";
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

function defaultAppPreinstallJobId(spaceId: string): string {
  return `default-app-preinstall:${spaceId}`;
}

function serializePreinstallDistribution(
  entries: DefaultAppDistributionEntry[],
): string {
  return JSON.stringify(cloneEntries(entries));
}

function parsePreinstallDistribution(
  value: string | null | undefined,
): DefaultAppDistributionEntry[] | null {
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
        })
      ),
    );
  } catch {
    return null;
  }
}

function serializeExpectedGroupIds(groupIds: string[]): string {
  return JSON.stringify(Array.from(new Set(groupIds)).sort());
}

function parseExpectedGroupIds(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string =>
        typeof item === "string" && item.length > 0
      )
      : [];
  } catch {
    return [];
  }
}

async function resolvePreinstallPlanForJob(
  env: DefaultAppDistributionEnv,
  row: DefaultAppPreinstallJobRow,
): Promise<DefaultAppPreinstallPlan> {
  const status = normalizePreinstallJobStatus(row.status);
  const stored = parsePreinstallDistribution(row.distributionJson);
  if (status === "deployment_queued" && stored) {
    return {
      entries: stored.filter((entry) => entry.preinstall),
      refreshed: false,
    };
  }
  const entries = (await resolveDefaultAppDistributionForBootstrap(env))
    .filter((entry) => entry.preinstall);
  return { entries, refreshed: true };
}

async function expectedPreinstallGroupsApplied(
  env: DefaultAppDistributionEnv,
  row: DefaultAppPreinstallJobRow,
): Promise<boolean> {
  const expectedGroupIds = parseExpectedGroupIds(row.expectedGroupIdsJson);
  if (expectedGroupIds.length === 0) return false;
  const db = defaultAppDistributionDeps.getDb(env.DB);
  const expectedEntries = parsePreinstallDistribution(row.distributionJson)
    ?.filter((entry) => entry.preinstall) ?? null;
  if (!expectedEntries || expectedEntries.length === 0) return false;
  for (const groupId of expectedGroupIds) {
    const group = await db.select()
      .from(groups)
      .where(and(
        eq(groups.spaceId, row.spaceId),
        eq(groups.id, groupId),
      ))
      .get();
    if (!group?.currentGroupDeploymentSnapshotId) return false;
    if (!expectedEntries) continue;
    const expected = expectedEntries.find((entry) =>
      isMatchingDefaultAppGroup(group, entry)
    );
    if (!expected) return false;
    const snapshot = await db.select({
      sourceKind: groupDeploymentSnapshots.sourceKind,
      sourceRepositoryUrl: groupDeploymentSnapshots.sourceRepositoryUrl,
      sourceRef: groupDeploymentSnapshots.sourceRef,
      sourceRefType: groupDeploymentSnapshots.sourceRefType,
      status: groupDeploymentSnapshots.status,
    }).from(groupDeploymentSnapshots)
      .where(and(
        eq(groupDeploymentSnapshots.id, group.currentGroupDeploymentSnapshotId),
        eq(groupDeploymentSnapshots.groupId, group.id),
        eq(groupDeploymentSnapshots.spaceId, row.spaceId),
      ))
      .get() as CurrentGroupDeploymentSnapshot | null;
    if (!snapshotMatchesDefaultAppEntry(snapshot, expected)) return false;
  }
  return true;
}

function changedRows(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  const record = result as Record<string, unknown>;
  const changes = record.changes ?? (record.meta as Record<string, unknown>)
    ?.changes ??
    record.rowsAffected;
  return typeof changes === "number" ? changes : null;
}

function updateChanged(result: unknown): boolean {
  const changes = changedRows(result);
  return changes === null ? true : changes > 0;
}

function buildDeploymentQueueMessage(
  entry: DefaultAppDistributionEntry,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    timestamp: string;
  },
): DeploymentQueueMessage {
  return {
    version: DEPLOYMENT_QUEUE_MESSAGE_VERSION,
    type: "group_deployment_snapshot",
    spaceId: params.spaceId,
    repositoryUrl: entry.repositoryUrl,
    ref: entry.ref,
    refType: entry.refType,
    createdByAccountId: params.createdByAccountId ?? params.spaceId,
    ...(entry.backendName ? { backendName: entry.backendName } : {}),
    ...(entry.envName ? { envName: entry.envName } : {}),
    reason: "default_app_preinstall",
    timestamp: messageTimestamp(params.timestamp),
  };
}

interface DefaultAppPreinstallResult {
  entries: DefaultAppDistributionEntry[];
  deploymentQueued: boolean;
  deploymentPending: boolean;
  expectedGroupIds: string[];
}

interface DefaultAppPreinstallPlan {
  entries: DefaultAppDistributionEntry[];
  refreshed: boolean;
}

function isMatchingDefaultAppGroup(
  group: typeof groups.$inferSelect,
  entry: DefaultAppDistributionEntry,
): boolean {
  return group.sourceKind === "git_ref" &&
    group.name === entry.name &&
    group.sourceRepositoryUrl === entry.repositoryUrl &&
    group.sourceRef === entry.ref &&
    group.sourceRefType === entry.refType;
}

function snapshotMatchesDefaultAppEntry(
  snapshot: CurrentGroupDeploymentSnapshot | null | undefined,
  entry: DefaultAppDistributionEntry,
): boolean {
  return !!snapshot &&
    snapshot.status === "applied" &&
    snapshot.sourceKind === "git_ref" &&
    snapshot.sourceRepositoryUrl === entry.repositoryUrl &&
    snapshot.sourceRef === entry.ref &&
    snapshot.sourceRefType === entry.refType;
}

export async function saveDefaultAppDistributionEntries(
  env: DefaultAppDistributionEnv,
  rawEntries: unknown[],
  options: { timestamp?: string } = {},
): Promise<DefaultAppDistributionEntry[]> {
  const defaults = readDefaults(env);
  let entries: DefaultAppDistributionEntry[];
  try {
    entries = assertUniqueEntries(
      rawEntries.map((entry) => normalizeRepositoryEntry(entry, defaults)),
    );
  } catch (error) {
    throw new DefaultAppDistributionInvalidError(
      error instanceof Error ? error.message : String(error),
      { cause: error },
    );
  }
  const db = defaultAppDistributionDeps.getDb(env.DB);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const rows = entries.map((entry, index) => ({
    id: entry.name,
    name: entry.name,
    title: entry.title,
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
    await db.delete(defaultAppDistributionEntries).run();
    await db.delete(defaultAppDistributionConfig)
      .where(eq(defaultAppDistributionConfig.id, "default"))
      .run();
    await db.insert(defaultAppDistributionConfig).values({
      id: "default",
      configured: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run();
    if (rows.length > 0) {
      await db.insert(defaultAppDistributionEntries).values(rows).run();
    }
    await db.update(defaultAppPreinstallJobs).set({
      status: "queued",
      nextAttemptAt: timestamp,
      lockedAt: null,
      lastError: null,
      distributionJson: null,
      expectedGroupIdsJson: null,
      deploymentQueuedAt: null,
      updatedAt: timestamp,
    }).where(eq(defaultAppPreinstallJobs.status, "blocked_by_config")).run();
  };

  if (hasTransactionSupport(env.DB)) {
    const txManager = new D1TransactionManager(env.DB);
    await txManager.runInTransaction(replaceRows);
  } else {
    await replaceRows();
  }
  setDistributionCacheEntry(env.DB, {
    key: defaultsCacheKey(defaults),
    distribution: { configured: true, entries: cloneEntries(entries) },
    expiresAt: Date.now() + DB_DISTRIBUTION_CACHE_TTL_MS,
  });
  return entries;
}

export async function clearDefaultAppDistributionEntries(
  env: DefaultAppDistributionEnv,
  options: { timestamp?: string } = {},
): Promise<void> {
  const db = defaultAppDistributionDeps.getDb(env.DB);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const clearRows = async () => {
    await db.delete(defaultAppDistributionEntries).run();
    await db.delete(defaultAppDistributionConfig)
      .where(eq(defaultAppDistributionConfig.id, "default"))
      .run();
    await db.insert(defaultAppDistributionConfig).values({
      id: "default",
      configured: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run();
    await db.update(defaultAppPreinstallJobs).set({
      status: "queued",
      nextAttemptAt: timestamp,
      lockedAt: null,
      lastError: null,
      distributionJson: null,
      expectedGroupIdsJson: null,
      deploymentQueuedAt: null,
      updatedAt: timestamp,
    }).where(eq(defaultAppPreinstallJobs.status, "blocked_by_config")).run();
  };

  if (hasTransactionSupport(env.DB)) {
    const txManager = new D1TransactionManager(env.DB);
    await txManager.runInTransaction(clearRows);
  } else {
    await clearRows();
  }
  setDistributionCacheEntry(env.DB, {
    key: defaultsCacheKey(readDefaults(env)),
    distribution: { configured: false, entries: [] },
    expiresAt: Date.now() + DB_DISTRIBUTION_CACHE_TTL_MS,
  });
}

async function preinstallDefaultAppsForSpaceDetailed(
  env: DefaultAppDistributionEnv,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    timestamp?: string;
    entries?: DefaultAppDistributionEntry[];
  },
): Promise<DefaultAppPreinstallResult> {
  const entries = params.entries ??
    (await resolveDefaultAppDistributionForBootstrap(env))
      .filter((entry) => entry.preinstall);
  if (entries.length === 0) {
    return {
      entries: [],
      deploymentQueued: false,
      deploymentPending: false,
      expectedGroupIds: [],
    };
  }

  const timestamp = params.timestamp ?? new Date().toISOString();
  const installed: DefaultAppDistributionEntry[] = [];
  let deploymentQueued = false;
  let deploymentPending = false;

  for (const entry of entries) {
    const job = buildDeploymentQueueMessage(entry, {
      spaceId: params.spaceId,
      createdByAccountId: params.createdByAccountId,
      timestamp,
    });

    if (!env.DEPLOY_QUEUE) {
      deploymentPending = true;
      installed.push(entry);
      continue;
    }
    await env.DEPLOY_QUEUE.send(job);
    deploymentQueued = true;
    installed.push(entry);
  }

  return {
    entries: installed,
    deploymentQueued,
    deploymentPending,
    expectedGroupIds: [],
  };
}

export async function preinstallDefaultAppsForSpace(
  env: DefaultAppDistributionEnv,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    timestamp?: string;
  },
): Promise<DefaultAppDistributionEntry[]> {
  if (!readDefaults(env).preinstall) return [];
  const result = await preinstallDefaultAppsForSpaceDetailed(env, params);
  return result.entries;
}

export async function enqueueDefaultAppPreinstallJob(
  env: DefaultAppDistributionEnv,
  params: {
    spaceId: string;
    createdByAccountId?: string;
    timestamp?: string;
  },
): Promise<string | null> {
  const db = defaultAppDistributionDeps.getDb(env.DB);
  const timestamp = params.timestamp ?? new Date().toISOString();
  const id = defaultAppPreinstallJobId(params.spaceId);
  let status: DefaultAppPreinstallJobStatus = "queued";
  const distributionJson: string | null = null;
  let lastError: string | null = null;
  let nextAttemptAt: string | null = timestamp;

  try {
    const defaults = readDefaults(env);
    if (!defaults.preinstall) return null;
  } catch (error) {
    if (!isDefaultAppDistributionInvalidError(error)) throw error;
    status = "blocked_by_config";
    lastError = error instanceof Error ? error.message : String(error);
    nextAttemptAt = nextRetryAt(timestamp, 1);
  }

  await runDbStatement(
    db.insert(defaultAppPreinstallJobs).values({
      id,
      spaceId: params.spaceId,
      createdByAccountId: params.createdByAccountId ?? null,
      status,
      attempts: 0,
      nextAttemptAt,
      lockedAt: null,
      lastError,
      distributionJson,
      expectedGroupIdsJson: null,
      deploymentQueuedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).onConflictDoNothing({
      target: defaultAppPreinstallJobs.id,
    }),
  );
  return id;
}

function duePreinstallJobs(
  rows: DefaultAppPreinstallJobRow[],
  timestamp: string,
  leaseMs: number,
  deploymentWatchdogMs: number,
): DefaultAppPreinstallJobRow[] {
  const staleBefore = staleLeaseBefore(timestamp, leaseMs);
  const deploymentStaleBefore = staleLeaseBefore(
    timestamp,
    deploymentWatchdogMs,
  );
  return rows.filter((row) => {
    const status = normalizePreinstallJobStatus(row.status);
    if (
      status === "queued" || status === "blocked_by_config" ||
      status === "paused_by_operator"
    ) {
      return !row.nextAttemptAt || row.nextAttemptAt <= timestamp;
    }
    if (status === "in_progress") {
      return Boolean(row.lockedAt && row.lockedAt <= staleBefore);
    }
    if (status === "deployment_queued") {
      const queuedAt = row.deploymentQueuedAt ?? row.updatedAt;
      return Boolean(queuedAt && queuedAt <= deploymentStaleBefore);
    }
    return false;
  });
}

async function claimDefaultAppPreinstallJob(
  db: ReturnType<typeof defaultAppDistributionDeps.getDb>,
  row: DefaultAppPreinstallJobRow,
  params: { attempts: number; timestamp: string },
): Promise<boolean> {
  const status = normalizePreinstallJobStatus(row.status);
  const lockedAtPredicate = row.lockedAt
    ? eq(defaultAppPreinstallJobs.lockedAt, row.lockedAt)
    : isNull(defaultAppPreinstallJobs.lockedAt);
  const result = await db.update(defaultAppPreinstallJobs).set({
    status: "in_progress",
    attempts: params.attempts,
    lockedAt: params.timestamp,
    updatedAt: params.timestamp,
  }).where(and(
    eq(defaultAppPreinstallJobs.id, row.id),
    eq(defaultAppPreinstallJobs.status, status),
    lockedAtPredicate,
  )).run();
  return updateChanged(result);
}

export async function processDefaultAppPreinstallJobs(
  env: DefaultAppDistributionEnv,
  options: {
    limit?: number;
    spaceId?: string;
    timestamp?: string;
    maxAttempts?: number;
    leaseMs?: number;
    deploymentWatchdogMs?: number;
  } = {},
): Promise<DefaultAppPreinstallJobSummary> {
  const db = defaultAppDistributionDeps.getDb(env.DB);
  const timestamp = options.timestamp ?? new Date().toISOString();
  const limit = Math.max(1, options.limit ?? 10);
  const leaseMs = Math.max(
    1,
    options.leaseMs ?? DEFAULT_APP_PREINSTALL_LEASE_MS,
  );
  const deploymentWatchdogMs = Math.max(
    1,
    options.deploymentWatchdogMs ?? DEFAULT_APP_DEPLOYMENT_QUEUE_WATCHDOG_MS,
  );
  const staleBefore = staleLeaseBefore(timestamp, leaseMs);
  const deploymentStaleBefore = staleLeaseBefore(
    timestamp,
    deploymentWatchdogMs,
  );
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_APP_PREINSTALL_MAX_ATTEMPTS,
  );
  const summary: DefaultAppPreinstallJobSummary = {
    scanned: 0,
    processed: 0,
    completed: 0,
    deploymentQueued: 0,
    blocked: 0,
    paused: 0,
    requeued: 0,
    failed: 0,
  };

  const duePredicate = or(
    and(
      eq(defaultAppPreinstallJobs.status, "queued"),
      or(
        isNull(defaultAppPreinstallJobs.nextAttemptAt),
        lte(defaultAppPreinstallJobs.nextAttemptAt, timestamp),
      ),
    ),
    and(
      eq(defaultAppPreinstallJobs.status, "blocked_by_config"),
      or(
        isNull(defaultAppPreinstallJobs.nextAttemptAt),
        lte(defaultAppPreinstallJobs.nextAttemptAt, timestamp),
      ),
    ),
    and(
      eq(defaultAppPreinstallJobs.status, "paused_by_operator"),
      or(
        isNull(defaultAppPreinstallJobs.nextAttemptAt),
        lte(defaultAppPreinstallJobs.nextAttemptAt, timestamp),
      ),
    ),
    and(
      eq(defaultAppPreinstallJobs.status, "in_progress"),
      lte(defaultAppPreinstallJobs.lockedAt, staleBefore),
    ),
    and(
      eq(defaultAppPreinstallJobs.status, "deployment_queued"),
      or(
        lte(defaultAppPreinstallJobs.deploymentQueuedAt, deploymentStaleBefore),
        and(
          isNull(defaultAppPreinstallJobs.deploymentQueuedAt),
          lte(defaultAppPreinstallJobs.updatedAt, deploymentStaleBefore),
        ),
      ),
    ),
  );
  const wherePredicate = options.spaceId
    ? and(duePredicate, eq(defaultAppPreinstallJobs.spaceId, options.spaceId))
    : duePredicate;
  const rows = await db.select()
    .from(defaultAppPreinstallJobs)
    .where(wherePredicate)
    .orderBy(
      asc(defaultAppPreinstallJobs.nextAttemptAt),
      asc(defaultAppPreinstallJobs.createdAt),
    )
    .limit(limit)
    .all();
  summary.scanned = rows.length;

  for (
    const row of duePreinstallJobs(
      rows,
      timestamp,
      leaseMs,
      deploymentWatchdogMs,
    )
  ) {
    const attempts = row.attempts + 1;
    const claimed = await claimDefaultAppPreinstallJob(db, row, {
      attempts,
      timestamp,
    });
    if (!claimed) continue;
    summary.processed += 1;

    try {
      const defaults = readDefaults(env);
      if (!defaults.preinstall) {
        await db.update(defaultAppPreinstallJobs).set({
          status: "paused_by_operator",
          nextAttemptAt: nextRetryAt(timestamp, attempts),
          lockedAt: null,
          lastError: "default app preinstall is disabled by operator",
          deploymentQueuedAt: null,
          updatedAt: new Date().toISOString(),
        }).where(eq(defaultAppPreinstallJobs.id, row.id)).run();
        summary.paused += 1;
        continue;
      }
      if (
        normalizePreinstallJobStatus(row.status) === "deployment_queued" &&
        await expectedPreinstallGroupsApplied(env, row)
      ) {
        await db.update(defaultAppPreinstallJobs).set({
          status: "completed",
          nextAttemptAt: null,
          lockedAt: null,
          lastError: null,
          updatedAt: new Date().toISOString(),
        }).where(eq(defaultAppPreinstallJobs.id, row.id)).run();
        summary.completed += 1;
        continue;
      }
      const plan = await resolvePreinstallPlanForJob(env, row);
      const result = await preinstallDefaultAppsForSpaceDetailed(env, {
        spaceId: row.spaceId,
        createdByAccountId: row.createdByAccountId ?? undefined,
        timestamp,
        entries: plan.entries,
      });
      const status = result.deploymentQueued
        ? "deployment_queued"
        : result.deploymentPending
        ? "blocked_by_config"
        : "completed";
      await db.update(defaultAppPreinstallJobs).set({
        status,
        nextAttemptAt: result.deploymentPending
          ? nextRetryAt(timestamp, attempts)
          : null,
        lockedAt: null,
        lastError: result.deploymentPending
          ? "default app deployment queue is unavailable"
          : null,
        distributionJson: plan.refreshed
          ? serializePreinstallDistribution(plan.entries)
          : row.distributionJson,
        expectedGroupIdsJson: serializeExpectedGroupIds(
          result.expectedGroupIds,
        ),
        deploymentQueuedAt: result.deploymentQueued ? timestamp : null,
        updatedAt: new Date().toISOString(),
      }).where(eq(defaultAppPreinstallJobs.id, row.id)).run();
      if (status === "deployment_queued") {
        summary.deploymentQueued += 1;
      } else if (status === "blocked_by_config") {
        summary.blocked += 1;
      } else {
        summary.completed += 1;
      }
    } catch (error) {
      const lastError = error instanceof Error ? error.message : String(error);
      const blockedByConfig = isDefaultAppDistributionInvalidError(error);
      const terminal = error instanceof DefaultAppPreinstallConflictError ||
        (!blockedByConfig && attempts >= maxAttempts);
      await db.update(defaultAppPreinstallJobs).set({
        status: blockedByConfig
          ? "blocked_by_config"
          : terminal
          ? "failed"
          : "queued",
        nextAttemptAt: terminal ? null : nextRetryAt(timestamp, attempts),
        lockedAt: null,
        lastError,
        deploymentQueuedAt: null,
        ...(blockedByConfig
          ? {
            distributionJson: null,
            expectedGroupIdsJson: null,
          }
          : {}),
        updatedAt: new Date().toISOString(),
      }).where(eq(defaultAppPreinstallJobs.id, row.id)).run();
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
