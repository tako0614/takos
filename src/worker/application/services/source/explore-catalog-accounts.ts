import type { Env } from "../../../shared/types/index.ts";
import { sourceServiceDeps } from "./deps.ts";

export type CatalogAccountsInstallationsEnv = Pick<
  Env,
  | "OIDC_DISCOVERY_URL"
  | "OIDC_ISSUER_URL"
  | "TAKOSUMI_ACCOUNTS_INTERNAL_URL"
  | "TAKOSUMI_ACCOUNTS_TOKEN"
  | "TAKOSUMI_ACCOUNTS_URL"
>;

type CatalogAccountsInstallationsFetch = typeof fetch;

export interface CatalogAccountsInstallationsReadConfig {
  baseUrl: string;
  token?: string;
  fetch?: CatalogAccountsInstallationsFetch;
}

export type AccountsInstallationProjection = {
  installationId: string;
  appId: string;
  status: string;
  runtimeMode: string | null;
  sourceUrl: string | null;
  sourceRef: string | null;
  sourceCommit: string | null;
  createdAt: string | null;
  updatedAt: string | null;
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
    ? value as Record<string, unknown>
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

export function resolveCatalogAccountsInstallationsReadConfig(
  env: CatalogAccountsInstallationsEnv,
): CatalogAccountsInstallationsReadConfig | null {
  const rawBaseUrl = readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL) ??
    readEnvString(env.OIDC_DISCOVERY_URL) ??
    readEnvString(env.OIDC_ISSUER_URL);
  if (!rawBaseUrl) return null;

  const baseUrl = normalizeAccountsBaseUrl(rawBaseUrl);
  if (!baseUrl) {
    sourceServiceDeps.logWarn(
      "Skipping Installation catalog readback because Accounts URL is invalid",
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

function buildAccountsInstallationsListUrl(
  baseUrl: string,
  spaceId: string,
): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = basePath.endsWith("/v1/installations")
    ? basePath
    : `${basePath}/v1/installations`;
  url.search = "";
  url.searchParams.set("space_id", spaceId);
  return url;
}

function parseAccountsInstallationProjection(
  value: unknown,
): AccountsInstallationProjection | null {
  const record = readRecord(value);
  if (!record) return null;
  const installationId = readString(record.id) ??
    readString(record.installation_id);
  const appId = readString(record.app_id) ?? readString(record.appId);
  if (!installationId || !appId) return null;

  const source = readRecord(record.source);
  return {
    installationId,
    appId,
    status: readString(record.status) ?? "installing",
    runtimeMode: readString(record.mode) ?? readString(record.runtime_mode),
    sourceUrl: source ? readString(source.url) : null,
    sourceRef: source ? readString(source.ref) : null,
    sourceCommit: source ? readString(source.commit) : null,
    createdAt: readString(record.created_at) ?? readString(record.createdAt),
    updatedAt: readString(record.updated_at) ?? readString(record.updatedAt),
  };
}

export async function fetchAccountsInstallationsForSpace(
  spaceId: string,
  config: CatalogAccountsInstallationsReadConfig | undefined,
): Promise<AccountsInstallationProjection[]> {
  if (!config) return [];
  const url = buildAccountsInstallationsListUrl(config.baseUrl, spaceId);
  const headers = new Headers({ accept: "application/json" });
  if (config.token?.trim()) {
    headers.set("authorization", `Bearer ${config.token.trim()}`);
  }

  try {
    const fetchImpl = config.fetch ?? fetch;
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      sourceServiceDeps.logWarn("Failed to list Installation readback", {
        status: response.status,
        url: url.toString(),
      });
      return [];
    }
    const body = await response.json() as unknown;
    const installations = readRecord(body)?.installations;
    if (!Array.isArray(installations)) return [];
    return installations
      .map(parseAccountsInstallationProjection)
      .filter((installation): installation is AccountsInstallationProjection =>
        installation !== null
      );
  } catch (error) {
    sourceServiceDeps.logWarn("Failed to list Installation readback", {
      url: url.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export function accountsInstallationUpdatedMs(
  installation: AccountsInstallationProjection,
): number {
  return Date.parse(installation.updatedAt ?? installation.createdAt ?? "") ||
    0;
}

export function setLatestAccountsInstallation(
  map: Map<string, AccountsInstallationProjection>,
  key: string | null,
  installation: AccountsInstallationProjection,
): void {
  if (!key) return;
  const current = map.get(key);
  if (
    !current ||
    accountsInstallationUpdatedMs(installation) >=
      accountsInstallationUpdatedMs(current)
  ) {
    map.set(key, installation);
  }
}
