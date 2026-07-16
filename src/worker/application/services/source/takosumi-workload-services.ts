import {
  takosumiCapsuleOutputsPath,
  takosumiInterfacesPath,
  takosumiSessionApiUrl,
} from "../takosumi-control-paths.ts";

/**
 * Takos launcher/service presentation derived from canonical Takosumi records.
 * Interfaces are the runtime authority. Ordinary OpenTofu Outputs are included
 * only as value-free apply evidence and never become launch endpoints.
 */

export type WorkloadServiceStatus =
  "ready" | "not_configured" | "unavailable" | "unknown";

export interface CapsuleWorkloadServiceSummary {
  id: string;
  capability: string;
  status: WorkloadServiceStatus;
  endpoint: string | null;
  secret_configured: boolean;
  token_expires_at: string | null;
}

export interface TakosumiControlReadConfig {
  baseUrl: string;
  token?: string;
  headers?: HeadersInit;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
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

function outputEvidenceServices(
  body: Record<string, unknown> | null,
): CapsuleWorkloadServiceSummary[] {
  const output = readRecord(body?.output);
  const publicOutputs = readRecord(output?.publicOutputs);
  if (!publicOutputs) return [];
  return Object.keys(publicOutputs)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({
      id: `output:${name}`,
      capability: "opentofu.output",
      status: "ready" as const,
      // Output values are not a runtime registry. Interface input mappings own
      // the endpoint projection and authorization boundary.
      endpoint: null,
      secret_configured: false,
      token_expires_at: null,
    }));
}

function interfaceStatus(value: unknown): WorkloadServiceStatus {
  switch (readString(value)) {
    case "Resolved":
      return "ready";
    case "Pending":
    case "NotReady":
      return "not_configured";
    case "Unknown":
    case "Terminating":
    case "Retired":
      return "unavailable";
    default:
      return "unknown";
  }
}

function resolvedInterfaceEndpoint(
  record: Record<string, unknown>,
): string | null {
  const spec = readRecord(record.spec);
  const status = readRecord(record.status);
  if (!spec || !status || readString(status.phase) !== "Resolved") return null;
  const resolvedInputs = readRecord(status.resolvedInputs);
  if (!resolvedInputs) return null;
  const access = readRecord(spec.access);
  const resourceUriInput = readString(access?.resourceUriInput);
  if (resourceUriInput) return readString(resolvedInputs[resourceUriInput]);

  // These are consumer-profile rules for the two first-party runtime types,
  // not Output-name inference. Unknown Interface types remain discoverable but
  // do not gain an endpoint by convention.
  const type = readString(spec.type);
  if (type === "interface.ui.surface") return readString(resolvedInputs.url);
  if (type === "mcp.server" || type === "protocol.mcp.server") {
    return (
      readString(resolvedInputs.endpoint) ?? readString(resolvedInputs.url)
    );
  }
  return null;
}

function interfaceService(
  value: unknown,
): CapsuleWorkloadServiceSummary | null {
  const record = readRecord(value);
  const metadata = readRecord(record?.metadata);
  const spec = readRecord(record?.spec);
  const status = readRecord(record?.status);
  const id = readString(metadata?.id);
  const name = readString(metadata?.name);
  const type = readString(spec?.type);
  if (!record || !id || !name || !type || !status) return null;
  return {
    id: `interface:${name}`,
    capability: type,
    status: interfaceStatus(status.phase),
    endpoint: resolvedInterfaceEndpoint(record),
    secret_configured: false,
    token_expires_at: null,
  };
}

export function projectCapsuleWorkloadServices(
  outputBody: Record<string, unknown> | null,
  interfacesBody: Record<string, unknown> | null,
): CapsuleWorkloadServiceSummary[] {
  const interfaces = Array.isArray(interfacesBody?.interfaces)
    ? interfacesBody.interfaces
        .map(interfaceService)
        .filter(
          (service): service is CapsuleWorkloadServiceSummary =>
            service !== null,
        )
    : [];
  return [...interfaces, ...outputEvidenceServices(outputBody)];
}

/** Local Takos UI DTO; the legacy key is intentionally confined to this edge. */
export function capsuleRuntimeToServicesBody(
  capsuleId: string,
  outputBody: Record<string, unknown> | null,
  interfacesBody: Record<string, unknown> | null,
): Record<string, unknown> {
  return {
    installation_id: capsuleId,
    services: projectCapsuleWorkloadServices(outputBody, interfacesBody),
  };
}

function requestHeaders(config: TakosumiControlReadConfig): Headers {
  const headers = new Headers(config.headers);
  headers.set("accept", "application/json");
  if (config.token?.trim()) {
    headers.set("authorization", `Bearer ${config.token.trim()}`);
  }
  return headers;
}

async function readJsonRecord(
  response: Response,
): Promise<Record<string, unknown> | null> {
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as unknown;
  return readRecord(body);
}

export async function fetchCapsuleWorkloadServices(
  capsuleId: string,
  workspaceId: string,
  config: TakosumiControlReadConfig | undefined,
): Promise<CapsuleWorkloadServiceSummary[]> {
  if (!config) return [];
  const outputUrl = takosumiSessionApiUrl(
    config.baseUrl,
    takosumiCapsuleOutputsPath(capsuleId),
  );
  const interfacesUrl = takosumiSessionApiUrl(
    config.baseUrl,
    takosumiInterfacesPath(),
  );
  interfacesUrl.searchParams.set("workspaceId", workspaceId);
  interfacesUrl.searchParams.set("ownerKind", "Capsule");
  interfacesUrl.searchParams.set("ownerId", capsuleId);
  const fetchImpl = config.fetch ?? fetch;
  try {
    const [outputResponse, interfacesResponse] = await Promise.all([
      fetchImpl(outputUrl, { headers: requestHeaders(config) }),
      fetchImpl(interfacesUrl, { headers: requestHeaders(config) }),
    ]);
    return projectCapsuleWorkloadServices(
      await readJsonRecord(outputResponse),
      await readJsonRecord(interfacesResponse),
    );
  } catch {
    return [];
  }
}
