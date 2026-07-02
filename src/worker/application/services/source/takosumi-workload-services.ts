import { TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH } from "@takosjp/takosumi-accounts-contract";

/**
 * Workload service display, derived from a Capsule's deployment OUTPUTS
 * (deploy decision D3). The OSS service projection ledger was removed from
 * Takosumi Accounts; the Takos product now reads the Capsule projection's
 * deployment-output payload (`deployment_outputs` on the legacy-named
 * projection envelope) instead of the retired `/installations/{id}/services`
 * endpoint.
 *
 * The functional env/URL material reaching workloads is owned separately by the
 * local service-publication catalog (apply-engine + group-managed-desired-state)
 * and is unaffected by this display projection.
 */

export type WorkloadServiceStatus =
  | "ready"
  | "not_configured"
  | "unavailable"
  | "unknown";

export interface InstallableAppWorkloadServiceSummary {
  id: string;
  capability: string;
  status: WorkloadServiceStatus;
  endpoint: string | null;
  secret_configured: boolean;
  token_expires_at: string | null;
}

export interface TakosumiAccountsServiceRequestConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
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

/**
 * Builds the legacy-named installed-service projection URL on the accounts
 * plane. The projection envelope carries the deployment-output projection that
 * backs the workload service display.
 */
export function accountsInstallationProjectionUrl(
  baseUrl: string,
  installationId: string,
): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const installationsPath = basePath.endsWith(
    TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
  )
    ? basePath
    : `${basePath}${TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH}`;
  url.pathname = `${installationsPath}/${encodeURIComponent(installationId)}`;
  url.search = "";
  return url;
}

function projectDeploymentOutput(
  value: unknown,
): InstallableAppWorkloadServiceSummary | null {
  const record = readRecord(value);
  if (!record) return null;
  const name =
    readString(record.name) ?? readString(record.kind) ?? null;
  if (!name) return null;
  const endpoint = readString(record.value);
  return {
    id: name,
    capability: "deployment.outputs",
    status: endpoint ? "ready" : "not_configured",
    endpoint,
    secret_configured: record.sensitive === true,
    token_expires_at: null,
  };
}

/**
 * Projects an installation envelope body (`{ installation: { deployment_outputs,
 * launch_url, ... } }`) into the workload service display summaries.
 */
export function projectWorkloadServicesFromInstallationBody(
  body: Record<string, unknown> | null,
): InstallableAppWorkloadServiceSummary[] {
  if (!body) return [];
  const installation = readRecord(body.installation) ?? body;
  const outputs = installation.deployment_outputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    return outputs
      .map(projectDeploymentOutput)
      .filter(
        (service): service is InstallableAppWorkloadServiceSummary =>
          service !== null,
      );
  }
  const launchUrl = readString(installation.launch_url);
  if (launchUrl) {
    return [
      {
        id: "launch_url",
        capability: "deployment.outputs",
        status: "ready",
        endpoint: launchUrl,
        secret_configured: false,
        token_expires_at: null,
      },
    ];
  }
  return [];
}

/**
 * Wraps an installation envelope body into the `{ installation_id, services }`
 * response shape the dashboard consumes for the per-installation services view.
 */
export function installationProjectionToServicesBody(
  installationId: string,
  body: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    installation_id: installationId,
    services: projectWorkloadServicesFromInstallationBody(body),
  };
}

export async function fetchAccountsInstallationWorkloadServices(
  installationId: string,
  config: TakosumiAccountsServiceRequestConfig | undefined,
): Promise<InstallableAppWorkloadServiceSummary[]> {
  if (!config) return [];
  const url = accountsInstallationProjectionUrl(config.baseUrl, installationId);
  const headers = new Headers({ accept: "application/json" });
  if (config.token?.trim()) {
    headers.set("authorization", `Bearer ${config.token.trim()}`);
  }

  try {
    const response = await (config.fetch ?? fetch)(url, { headers });
    if (!response.ok) return [];
    const body = (await response.json()) as unknown;
    return projectWorkloadServicesFromInstallationBody(readRecord(body));
  } catch {
    return [];
  }
}
