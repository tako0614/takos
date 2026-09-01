import type {
  McpRegistrySearchCandidate,
  McpRegistrySearchResult,
  McpRegistrySource,
  McpServerCardDiscoveryResult,
} from "../../types/index.ts";

type UnknownRecord = Record<string, unknown>;

const SOURCE_KINDS = new Set([
  "official",
  "organization",
  "community",
  "custom",
]);
const DISCOVERY_SOURCE_KINDS = new Set([...SOURCE_KINDS, "server_card"]);
const AUTH_TYPES = new Set(["none", "bearer", "header"]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isRegistrySource(value: unknown): value is McpRegistrySource {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isNullableString(value.workspace_id) &&
    typeof value.name === "string" &&
    typeof value.base_url === "string" &&
    typeof value.source_kind === "string" &&
    SOURCE_KINDS.has(value.source_kind) &&
    typeof value.auth_type === "string" &&
    AUTH_TYPES.has(value.auth_type) &&
    isNullableString(value.auth_header_name) &&
    typeof value.credential_configured === "boolean" &&
    typeof value.enabled === "boolean" &&
    Number.isInteger(value.priority) &&
    value.priority_semantics === "higher_first" &&
    typeof value.read_only === "boolean" &&
    typeof value.preview === "boolean" &&
    typeof value.best_effort === "boolean" &&
    typeof value.verification_status === "string" &&
    typeof value.security_status === "string" &&
    isNullableString(value.created_at) &&
    isNullableString(value.updated_at) &&
    value.safety_assertion === "none"
  );
}

export function parseMcpRegistrySources(value: unknown): McpRegistrySource[] {
  if (!Array.isArray(value) || !value.every(isRegistrySource)) {
    throw new Error("Invalid MCP Registry sources response");
  }
  return value;
}

export function parseMcpRegistrySource(value: unknown): McpRegistrySource {
  if (!isRegistrySource(value)) {
    throw new Error("Invalid MCP Registry source response");
  }
  return value;
}

function isRegistryPackage(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.registry_type === "npm" || value.registry_type === "oci") &&
    isNullableString(value.registry_base_url) &&
    typeof value.identifier === "string" &&
    isNullableString(value.version) &&
    isNullableString(value.file_sha256) &&
    typeof value.transport_type === "string" &&
    isNullableString(value.transport_url) &&
    isNullableString(value.runtime_hint) &&
    typeof value.requires_configuration === "boolean"
  );
}

function isRegistryProvenance(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.source_id === "string" &&
    typeof value.source_name === "string" &&
    typeof value.source_kind === "string" &&
    DISCOVERY_SOURCE_KINDS.has(value.source_kind) &&
    typeof value.base_url === "string" &&
    Number.isInteger(value.priority) &&
    typeof value.preview === "boolean" &&
    typeof value.best_effort === "boolean" &&
    typeof value.server_name === "string" &&
    typeof value.server_version === "string" &&
    (value.card_url === undefined || isNullableString(value.card_url))
  );
}

function isRegistryCandidate(
  value: unknown,
): value is McpRegistrySearchCandidate {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    isNullableString(value.title) &&
    isNullableString(value.description) &&
    typeof value.version === "string" &&
    isNullableString(value.url) &&
    (value.transport === "streamable-http" || value.transport === "package") &&
    isNullableString(value.repository_url) &&
    isNullableString(value.repository_subfolder) &&
    typeof value.requires_configuration === "boolean" &&
    Array.isArray(value.packages) &&
    value.packages.every(isRegistryPackage) &&
    Array.isArray(value.provenance) &&
    value.provenance.every(isRegistryProvenance)
  );
}

function isSearchSourceResult(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.source_id === "string" &&
    typeof value.source_name === "string" &&
    Number.isInteger(value.matched_servers) &&
    Number.isInteger(value.candidate_count) &&
    Number.isInteger(value.skipped_remote_count)
  );
}

function isSearchFailure(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.source_id === "string" &&
    typeof value.source_name === "string" &&
    typeof value.source_kind === "string" &&
    DISCOVERY_SOURCE_KINDS.has(value.source_kind) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    (value.status === null || Number.isInteger(value.status))
  );
}

export function parseMcpRegistrySearchResult(
  value: unknown,
): McpRegistrySearchResult {
  if (
    !isRecord(value) ||
    typeof value.query !== "string" ||
    !Array.isArray(value.candidates) ||
    !value.candidates.every(isRegistryCandidate) ||
    !Array.isArray(value.source_results) ||
    !value.source_results.every(isSearchSourceResult) ||
    !Array.isArray(value.source_failures) ||
    !value.source_failures.every(isSearchFailure) ||
    !isRecord(value.limitations) ||
    typeof value.limitations.mode !== "string" ||
    value.limitations.upstream_search !== "server_name_substring_only" ||
    typeof value.limitations.cached_full_text_aggregation !== "boolean" ||
    typeof value.limitations.credentials_supported !== "boolean" ||
    typeof value.limitations.note !== "string"
  ) {
    throw new Error("Invalid MCP Registry search response");
  }
  if (value.discovery !== undefined) {
    if (
      !isRecord(value.discovery) ||
      value.discovery.type !== "server_card" ||
      value.discovery.experimental !== true ||
      typeof value.discovery.catalog_url !== "string"
    ) {
      throw new Error("Invalid MCP Registry discovery response");
    }
  }
  return value as unknown as McpRegistrySearchResult;
}

export function parseMcpServerCardDiscovery(
  value: unknown,
): McpServerCardDiscoveryResult {
  if (
    !isRecord(value) ||
    typeof value.domain !== "string" ||
    typeof value.catalog_url !== "string" ||
    value.experimental !== true ||
    !Array.isArray(value.candidates) ||
    !value.candidates.every(isRegistryCandidate) ||
    !Array.isArray(value.failures) ||
    !value.failures.every(
      (failure) =>
        isRecord(failure) &&
        isNullableString(failure.entry_identifier) &&
        typeof failure.message === "string",
    )
  ) {
    throw new Error("Invalid MCP Server Card response");
  }
  return value as unknown as McpServerCardDiscoveryResult;
}
