import type {
  TakosumiAccountsWorkloadServiceProjection,
  TakosumiAccountsWorkloadServiceStatus,
} from "@takosjp/takosumi-accounts-contract";

export interface TakosumiAccountsServiceRequestConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface InstallableAppWorkloadServiceSummary {
  id: string;
  material_kind: string;
  status: TakosumiAccountsWorkloadServiceStatus | "unknown";
  endpoint: string | null;
  secret_configured: boolean;
  token_expires_at: string | null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
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
  return value === "ready" || value === "not_configured" ||
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
  const installationsPath = basePath.endsWith("/v1/installations")
    ? basePath
    : `${basePath}/v1/installations`;
  url.pathname = `${installationsPath}/${
    encodeURIComponent(installationId)
  }/services`;
  url.search = "";
  return url;
}

export function sanitizeWorkloadServiceProjection(
  value: unknown,
): InstallableAppWorkloadServiceSummary | null {
  const record = readRecord(value) as
    | (Partial<TakosumiAccountsWorkloadServiceProjection> &
      Record<string, unknown>)
    | null;
  if (!record) return null;
  const id = readString(record.id);
  const materialKind = readString(record.material_kind);
  if (!id || !materialKind) return null;
  return {
    id,
    material_kind: materialKind,
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
    .filter((service): service is InstallableAppWorkloadServiceSummary =>
      service !== null
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
    const body = await response.json() as unknown;
    return sanitizeWorkloadServices(readRecord(body)?.services);
  } catch {
    return [];
  }
}
