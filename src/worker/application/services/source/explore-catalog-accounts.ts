import type { Env } from "../../../shared/types/index.ts";
import { sourceServiceDeps } from "./deps.ts";
import {
  fetchCapsuleWorkloadServices,
  type CapsuleWorkloadServiceSummary,
} from "./takosumi-workload-services.ts";
import {
  takosumiSessionApiUrl,
  takosumiSourcePath,
  takosumiWorkspaceCapsulesPath,
} from "../takosumi-control-paths.ts";

export type CatalogTakosumiCapsulesEnv = Pick<
  Env,
  | "OIDC_DISCOVERY_URL"
  | "OIDC_ISSUER_URL"
  | "TAKOSUMI_ACCOUNTS_INTERNAL_URL"
  | "TAKOSUMI_ACCOUNTS_TOKEN"
  | "TAKOSUMI_ACCOUNTS_URL"
>;

type CatalogTakosumiCapsulesFetch = typeof fetch;

export interface CatalogTakosumiCapsulesReadConfig {
  baseUrl: string;
  token?: string;
  fetch?: CatalogTakosumiCapsulesFetch;
}

export type CatalogCapsuleRecord = {
  capsuleId: string;
  appId: string;
  status: string;
  runtimeMode: string | null;
  sourceUrl: string | null;
  sourceRef: string | null;
  sourceCommit: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  services: CapsuleWorkloadServiceSummary[];
};

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readEnvString(value: string | undefined): string | undefined {
  return readString(value) ?? undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeAccountsBaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function resolveCatalogTakosumiCapsulesReadConfig(
  env: CatalogTakosumiCapsulesEnv,
): CatalogTakosumiCapsulesReadConfig | null {
  const rawBaseUrl =
    readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL) ??
    readEnvString(env.OIDC_DISCOVERY_URL) ??
    readEnvString(env.OIDC_ISSUER_URL);
  if (!rawBaseUrl) return null;

  const baseUrl = normalizeAccountsBaseUrl(rawBaseUrl);
  if (!baseUrl) {
    sourceServiceDeps.logWarn(
      "Skipping canonical Capsule readback because the Takosumi URL is invalid",
      { baseUrl: rawBaseUrl },
    );
    return null;
  }

  return {
    baseUrl,
    ...(readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN)
      ? { token: readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN) }
      : {}),
  };
}

function requestHeaders(config: CatalogTakosumiCapsulesReadConfig): Headers {
  const headers = new Headers({ accept: "application/json" });
  if (config.token?.trim()) {
    headers.set("authorization", `Bearer ${config.token.trim()}`);
  }
  return headers;
}

function canonicalCapsuleStatus(value: unknown): string {
  switch (readString(value)) {
    case "pending":
      return "installing";
    case "active":
      return "ready";
    case "stale":
    case "error":
    case "disabled":
    case "destroyed":
      return readString(value)!;
    default:
      return "unknown";
  }
}

async function readSource(
  sourceId: string,
  config: CatalogTakosumiCapsulesReadConfig,
): Promise<Record<string, unknown> | null> {
  const fetchImpl = config.fetch ?? fetch;
  const response = await fetchImpl(
    takosumiSessionApiUrl(config.baseUrl, takosumiSourcePath(sourceId)),
    { headers: requestHeaders(config) },
  );
  if (!response.ok) return null;
  return readRecord(readRecord((await response.json()) as unknown)?.source);
}

async function projectCapsule(
  value: unknown,
  workspaceId: string,
  config: CatalogTakosumiCapsulesReadConfig,
): Promise<CatalogCapsuleRecord | null> {
  const capsule = readRecord(value);
  const capsuleId = readString(capsule?.id);
  const appId = readString(capsule?.name);
  const sourceId = readString(capsule?.sourceId);
  if (!capsule || !capsuleId || !appId || !sourceId) return null;
  const [source, services] = await Promise.all([
    readSource(sourceId, config),
    fetchCapsuleWorkloadServices(capsuleId, workspaceId, config),
  ]);
  return {
    capsuleId,
    appId,
    status: canonicalCapsuleStatus(capsule.status),
    runtimeMode: readString(capsule.environment),
    sourceUrl: readString(source?.url),
    sourceRef: readString(source?.defaultRef),
    sourceCommit: null,
    createdAt: readString(capsule.createdAt),
    updatedAt: readString(capsule.updatedAt),
    services,
  };
}

export async function fetchCatalogCapsulesForWorkspace(
  workspaceId: string,
  config: CatalogTakosumiCapsulesReadConfig | undefined,
): Promise<CatalogCapsuleRecord[]> {
  if (!config) return [];
  const url = takosumiSessionApiUrl(
    config.baseUrl,
    takosumiWorkspaceCapsulesPath(workspaceId),
  );
  url.searchParams.set("includeDestroyed", "false");
  try {
    const response = await (config.fetch ?? fetch)(url, {
      headers: requestHeaders(config),
    });
    if (!response.ok) {
      sourceServiceDeps.logWarn("Failed to list canonical Capsules", {
        status: response.status,
        url: url.toString(),
      });
      return [];
    }
    const body = readRecord((await response.json()) as unknown);
    if (!Array.isArray(body?.capsules)) return [];
    const rows = await Promise.all(
      body.capsules.map((capsule) =>
        projectCapsule(capsule, workspaceId, config),
      ),
    );
    return rows.filter(
      (capsule): capsule is CatalogCapsuleRecord => capsule !== null,
    );
  } catch (error) {
    sourceServiceDeps.logWarn("Failed to list canonical Capsules", {
      url: url.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function catalogCapsuleUpdatedMs(capsule: CatalogCapsuleRecord): number {
  return Date.parse(capsule.updatedAt ?? capsule.createdAt ?? "") || 0;
}

export function setLatestCatalogCapsule(
  map: Map<string, CatalogCapsuleRecord>,
  key: string | null,
  capsule: CatalogCapsuleRecord,
): void {
  if (!key) return;
  const current = map.get(key);
  if (
    !current ||
    catalogCapsuleUpdatedMs(capsule) >= catalogCapsuleUpdatedMs(current)
  ) {
    map.set(key, capsule);
  }
}
