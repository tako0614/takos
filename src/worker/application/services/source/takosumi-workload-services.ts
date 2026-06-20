import { TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH } from "@takosjp/takosumi-accounts-contract";
import type {
  TakosumiAccountsServiceGraphServiceProjection,
  TakosumiAccountsServiceGraphServiceStatus,
} from "@takosjp/takosumi-accounts-contract";

export interface TakosumiAccountsServiceRequestConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface InstallableAppWorkloadServiceSummary {
  id: string;
  capability: string;
  status: TakosumiAccountsServiceGraphServiceStatus | "unknown";
  endpoint: string | null;
  secret_configured: boolean;
  token_expires_at: string | null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readWorkloadServiceStatus(
  value: unknown,
): InstallableAppWorkloadServiceSummary["status"] {
  return value === "ready" ||
    value === "not_configured" ||
    value === "unavailable"
    ? value
    : "unknown";
}

export function accountsInstallationServicesUrl(
  baseUrl: string,
  installationId: string,
): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const installationsPath = basePath.endsWith(
    TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH,
  )
    ? basePath
    : `${basePath}${TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH}`;
  url.pathname = `${installationsPath}/${encodeURIComponent(
    installationId,
  )}/services`;
  url.search = "";
  return url;
}

export function sanitizeWorkloadServiceProjection(
  value: unknown,
): InstallableAppWorkloadServiceSummary | null {
  const record = readRecord(value) as
    | (Partial<TakosumiAccountsServiceGraphServiceProjection> &
        Record<string, unknown>)
    | null;
  if (!record) return null;
  const id = readString(record.id);
  const capability = readString(record.capability);
  if (!id || !capability) return null;
  return {
    id,
    capability: capability,
    status: readWorkloadServiceStatus(record.status),
    endpoint: readString(record.endpoint),
    secret_configured: Boolean(readString(record.secret_ref)),
    token_expires_at: readString(record.token_expires_at),
  };
}

export function sanitizeWorkloadServices(
  value: unknown,
): InstallableAppWorkloadServiceSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitizeWorkloadServiceProjection)
    .filter(
      (service): service is InstallableAppWorkloadServiceSummary =>
        service !== null,
    );
}

export function sanitizeWorkloadServicesBody(
  body: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!body) return body;
  const services = sanitizeWorkloadServices(body.services);
  if (!Array.isArray(body.services)) return body;
  return {
    ...body,
    services,
  };
}

export async function fetchAccountsInstallationWorkloadServices(
  installationId: string,
  config: TakosumiAccountsServiceRequestConfig | undefined,
): Promise<InstallableAppWorkloadServiceSummary[]> {
  if (!config) return [];
  const url = accountsInstallationServicesUrl(config.baseUrl, installationId);
  const headers = new Headers({ accept: "application/json" });
  if (config.token?.trim()) {
    headers.set("authorization", `Bearer ${config.token.trim()}`);
  }

  try {
    const response = await (config.fetch ?? fetch)(url, { headers });
    if (!response.ok) return [];
    const body = (await response.json()) as unknown;
    return sanitizeWorkloadServices(readRecord(body)?.services);
  } catch {
    return [];
  }
}
