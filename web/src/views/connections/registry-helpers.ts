import type {
  McpRegistrySearchCandidate,
  McpDiscoverySourceKind,
} from "../../types/index.ts";
import { deriveMcpServerName } from "./connection-input.ts";

export type RegistryCandidateConnectionStatus =
  | "connectable"
  | "deployable"
  | "deployment_unavailable"
  | "configuration_required"
  | "unsupported_transport"
  | "invalid_endpoint";

export interface RegistryCandidateConnectionInfo {
  status: RegistryCandidateConnectionStatus;
  hostname: string | null;
  endpoint: string | null;
}

export function getRegistryNamespace(serverName: string): string {
  const trimmed = serverName.trim();
  const separator = trimmed.indexOf("/");
  return separator > 0 ? trimmed.slice(0, separator) : trimmed;
}

export function getSafeHttpsLink(rawValue: string | null): string | null {
  if (!rawValue) return null;
  try {
    const parsed = new URL(rawValue);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getSafeMcpHttpsEndpoint(
  rawValue: string | null,
): string | null {
  const safeUrl = getSafeHttpsLink(rawValue);
  if (!safeUrl) return null;
  const parsed = new URL(safeUrl);
  return parsed.port ? null : parsed.toString();
}

export function isValidRegistryBaseUrl(rawValue: string): boolean {
  const safeUrl = getSafeMcpHttpsEndpoint(rawValue.trim());
  if (!safeUrl) return false;
  const parsed = new URL(safeUrl);
  return !parsed.search && !parsed.hash && !parsed.port;
}

export function getRegistryCandidateConnectionInfo(
  candidate: McpRegistrySearchCandidate,
): RegistryCandidateConnectionInfo {
  if (candidate.transport === "package") {
    return {
      status: getSafeHttpsLink(candidate.repository_url)
        ? "deployable"
        : "deployment_unavailable",
      hostname: null,
      endpoint: null,
    };
  }
  if (candidate.transport !== "streamable-http") {
    return { status: "unsupported_transport", hostname: null, endpoint: null };
  }
  const endpoint = getSafeMcpHttpsEndpoint(candidate.url);
  if (!endpoint) {
    return { status: "invalid_endpoint", hostname: null, endpoint: null };
  }
  const hostname = new URL(endpoint).hostname;
  if (candidate.requires_configuration) {
    return { status: "configuration_required", hostname, endpoint };
  }
  return {
    status: "connectable",
    hostname,
    endpoint,
  };
}

export function deriveRegistryConnectionName(
  candidate: McpRegistrySearchCandidate,
): string {
  const leaf = candidate.name.split("/").at(-1)?.trim() ?? candidate.name;
  return deriveMcpServerName(leaf);
}

export function registrySourceKindLabelKey(
  sourceKind: McpDiscoverySourceKind,
):
  | "registrySourceKindOfficial"
  | "registrySourceKindOrganization"
  | "registrySourceKindCommunity"
  | "registrySourceKindCustom"
  | "registrySourceKindServerCard" {
  switch (sourceKind) {
    case "official":
      return "registrySourceKindOfficial";
    case "organization":
      return "registrySourceKindOrganization";
    case "community":
      return "registrySourceKindCommunity";
    case "custom":
      return "registrySourceKindCustom";
    case "server_card":
      return "registrySourceKindServerCard";
  }
}
