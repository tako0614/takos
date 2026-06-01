import {
  GROUP_NAME_REQUIREMENTS,
  isValidGroupName,
} from "../../../shared/utils/naming-utils.ts";

import type {
  DefaultAppBackend,
  DefaultAppBindingSummary,
  DefaultAppBindingType,
  DefaultAppDistributionConfigRow,
  DefaultAppDistributionDefaults,
  DefaultAppDistributionEntry,
  DefaultAppDistributionRow,
  DefaultAppRefType,
  DefaultAppRuntimeMode,
} from "./default-app-distribution-types.ts";

export const DEFAULT_APP_RUNTIME_MODES: readonly DefaultAppRuntimeMode[] = [
  "shared-cell",
  "dedicated",
  "self-hosted",
];

export const DEFAULT_APP_BINDING_TYPES: readonly DefaultAppBindingType[] = [
  "identity.oidc@v1",
  "database.postgres@v1",
  "object-store.s3-compatible@v1",
  "domain.http@v1",
  "install-launch-token@v1",
];

export const DEFAULT_APP_CATEGORIES = [
  "app",
  "service",
  "library",
  "template",
  "social",
] as const;

export function cloneEntries(
  entries: DefaultAppDistributionEntry[],
): DefaultAppDistributionEntry[] {
  return entries.map((entry) => ({
    ...entry,
    ...(entry.tags ? { tags: [...entry.tags] } : {}),
    ...(entry.runtimeModes ? { runtimeModes: [...entry.runtimeModes] } : {}),
    ...(entry.bindings
      ? { bindings: entry.bindings.map((binding) => ({ ...binding })) }
      : {}),
  }));
}

export function readBool(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`boolean value is invalid: ${value}`);
}

export function normalizeRefType(
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

export function normalizeBackend(
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

export function normalizeCategory(
  value: unknown,
  field = "category",
): DefaultAppDistributionEntry["category"] {
  if (value === undefined || value === null || value === "") return undefined;
  return DEFAULT_APP_CATEGORIES.includes(
      value as NonNullable<DefaultAppDistributionEntry["category"]>,
    )
    ? value as NonNullable<DefaultAppDistributionEntry["category"]>
    : (() => {
      throw new Error(
        `default app distribution ${field} is invalid: ${String(value)}`,
      );
    })();
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("default app distribution entries must be objects");
  }
  return value as Record<string, unknown>;
}

export function readString(
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

export function readOptionalString(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = record[field];
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || undefined;
}

export function readEnvString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function readStringArray(
  record: Record<string, unknown>,
  field: string,
  itemPattern: RegExp,
  opts: { maxItems: number; label: string },
): string[] | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`default app distribution entry.${field} must be an array`);
  }
  if (value.length > opts.maxItems) {
    throw new Error(
      `default app distribution entry.${field} must contain at most ${opts.maxItems} items`,
    );
  }
  const items = value.map((item) =>
    typeof item === "string" ? item.trim().toLowerCase() : ""
  ).filter(Boolean);
  for (const item of items) {
    if (!itemPattern.test(item)) {
      throw new Error(
        `default app distribution entry.${field} contains invalid ${opts.label}: ${item}`,
      );
    }
  }
  return Array.from(new Set(items));
}

export function normalizeRuntimeModes(
  value: unknown,
): DefaultAppRuntimeMode[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error(
      "default app distribution entry.runtimeModes must contain 1-3 runtime modes",
    );
  }
  const modes: DefaultAppRuntimeMode[] = [];
  for (const rawMode of value) {
    if (!DEFAULT_APP_RUNTIME_MODES.includes(rawMode as DefaultAppRuntimeMode)) {
      throw new Error(
        `default app distribution entry.runtimeModes contains invalid mode: ${
          String(rawMode)
        }`,
      );
    }
    const mode = rawMode as DefaultAppRuntimeMode;
    if (!modes.includes(mode)) modes.push(mode);
  }
  return modes;
}

export function normalizeBindingSummaries(
  value: unknown,
): DefaultAppBindingSummary[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    throw new Error(
      "default app distribution entry.bindings must contain 1-32 bindings",
    );
  }
  const names = new Set<string>();
  return value.map((raw, index) => {
    const record = asRecord(raw);
    const name = readString(record, "name");
    if (!/^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) {
      throw new Error(
        `default app distribution entry.bindings[${index}].name is invalid: ${name}`,
      );
    }
    if (names.has(name)) {
      throw new Error(`duplicate default app binding name: ${name}`);
    }
    names.add(name);
    const type = readString(record, "type");
    if (!DEFAULT_APP_BINDING_TYPES.includes(type as DefaultAppBindingType)) {
      throw new Error(
        `default app distribution entry.bindings[${index}].type is invalid: ${type}`,
      );
    }
    return {
      name,
      type: type as DefaultAppBindingType,
      required: typeof record.required === "boolean" ? record.required : true,
    };
  });
}

export function assertValidGroupName(name: string): void {
  if (!isValidGroupName(name)) {
    throw new Error(
      `default app group name is invalid: ${name}; ${GROUP_NAME_REQUIREMENTS}`,
    );
  }
}

export function assertValidRepositoryUrl(url: string): void {
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

export function assertValidAppId(appId: string): void {
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(appId)) {
    throw new Error(
      `default app distribution entry.appId is invalid: ${appId}`,
    );
  }
}

export function assertValidPublisher(publisher: string): void {
  if (!/^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$/.test(publisher)) {
    throw new Error(
      `default app distribution entry.publisher is invalid: ${publisher}`,
    );
  }
}

export function assertValidHomepage(homepage: string): void {
  let parsed: URL;
  try {
    parsed = new URL(homepage);
  } catch {
    throw new Error(
      `default app distribution entry.homepage must use HTTPS: ${homepage}`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `default app distribution entry.homepage must use HTTPS: ${homepage}`,
    );
  }
}

export function assertValidSourcePath(sourcePath: string): void {
  if (
    sourcePath.startsWith("/") ||
    sourcePath.split("/").some((part) => part === "..")
  ) {
    throw new Error(
      `default app distribution entry.sourcePath must be a repository-relative path: ${sourcePath}`,
    );
  }
}

export function repositoryUrlDuplicateKey(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  const pathname = parsed.pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
  parsed.pathname = pathname;
  parsed.hostname = parsed.hostname.toLowerCase();
  return parsed.toString();
}

export function assertUniqueEntries(
  entries: DefaultAppDistributionEntry[],
): DefaultAppDistributionEntry[] {
  const names = new Set<string>();
  const appIds = new Set<string>();
  const repositoryUrls = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new Error(`duplicate default app group name: ${entry.name}`);
    }
    names.add(entry.name);
    if (entry.appId) {
      if (appIds.has(entry.appId)) {
        throw new Error(`duplicate default app appId: ${entry.appId}`);
      }
      appIds.add(entry.appId);
    }

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

export function groupNameFromRepositoryUrl(repositoryUrl: string): string {
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

export function normalizeEntry(
  raw: unknown,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry {
  const record = asRecord(raw);
  const name = readString(record, "name");
  assertValidGroupName(name);
  const repositoryUrl = readString(record, "repositoryUrl");
  assertValidRepositoryUrl(repositoryUrl);
  const title = readString(record, "title", name);
  const appId = readOptionalString(record, "appId") ??
    readOptionalString(record, "app_id");
  if (appId) assertValidAppId(appId);
  const description = readOptionalString(record, "description");
  const publisher = readOptionalString(record, "publisher");
  if (publisher) assertValidPublisher(publisher);
  const homepage = readOptionalString(record, "homepage");
  if (homepage) assertValidHomepage(homepage);
  const icon = readOptionalString(record, "icon");
  const category = normalizeCategory(record.category, "entry.category");
  const tags = readStringArray(record, "tags", /^[a-z0-9][a-z0-9_-]*$/, {
    maxItems: 10,
    label: "tag",
  });
  const sourcePath = readOptionalString(record, "sourcePath") ??
    readOptionalString(record, "source_path");
  if (sourcePath) assertValidSourcePath(sourcePath);
  const runtimeModes = normalizeRuntimeModes(
    record.runtimeModes ?? record.runtime_modes,
  );
  const bindings = normalizeBindingSummaries(record.bindings);
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
    ...(appId ? { appId } : {}),
    ...(description ? { description } : {}),
    ...(publisher ? { publisher } : {}),
    ...(homepage ? { homepage } : {}),
    ...(icon ? { icon } : {}),
    ...(category ? { category } : {}),
    ...(tags ? { tags } : {}),
    repositoryUrl,
    ref: readString(record, "ref", defaults.ref),
    refType: normalizeRefType(
      record.refType ?? defaults.refType,
      "entry.refType",
    ),
    ...(sourcePath ? { sourcePath } : {}),
    ...(runtimeModes ? { runtimeModes } : {}),
    ...(bindings ? { bindings } : {}),
    preinstall,
    ...(backendName ? { backendName } : {}),
    ...(envName ? { envName } : {}),
  };
}

export function normalizeRepositoryEntry(
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

export function normalizeDatabaseEntry(
  row: DefaultAppDistributionRow,
  defaults: DefaultAppDistributionDefaults,
): DefaultAppDistributionEntry {
  return normalizeEntry(
    {
      name: row.name,
      title: row.title,
      ...(row.icon ? { icon: row.icon } : {}),
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

export function normalizeConfigRow(
  row: DefaultAppDistributionConfigRow | undefined,
): boolean | null {
  if (!row) return null;
  return row.configured;
}
