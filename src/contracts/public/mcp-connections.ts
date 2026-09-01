export const MCP_CONNECTIONS_EXPORT_FORMAT = "takos.mcp.connections";
export const MCP_CONNECTIONS_EXPORT_VERSION = 1;

// The direct portable document must stay importable through the product's
// ordinary 1 MiB JSON boundary. Larger inventories need an assisted artifact
// flow rather than a partial or self-incompatible download.
export const MAX_MCP_CONNECTIONS_DOCUMENT_BYTES = 1024 * 1024;
export const MAX_MCP_CONNECTIONS_REGISTRY_SOURCES = 17;
export const MAX_MCP_CONNECTIONS = 32;
export const MAX_MCP_CONNECTION_TOOL_POLICIES = 2048;

export type McpConnectionsRegistrySourceKind =
  | "official"
  | "organization"
  | "community"
  | "custom";
export type McpConnectionsRegistryAuthType = "none" | "bearer" | "header";
export type McpConnectionInvocationPolicy =
  | "automatic"
  | "confirm_each_time";

export interface McpConnectionToolPolicyDocument {
  name: string;
  schema_hash: string;
  enabled: boolean;
  invocation_policy: McpConnectionInvocationPolicy;
}

export interface McpConnectionDocument {
  name: string;
  url: string;
  transport: "streamable-http";
  enabled: boolean;
  scope: string | null;
  tools: McpConnectionToolPolicyDocument[];
}

export interface McpConnectionsRegistrySourceDocument {
  kind: McpConnectionsRegistrySourceKind;
  name: string;
  base_url: string;
  enabled: boolean;
  priority: number;
  auth_type: McpConnectionsRegistryAuthType;
  auth_header_name: string | null;
  credential_required: boolean;
}

export interface McpConnectionsDocument {
  format: typeof MCP_CONNECTIONS_EXPORT_FORMAT;
  version: typeof MCP_CONNECTIONS_EXPORT_VERSION;
  exported_at: string;
  registry_sources: McpConnectionsRegistrySourceDocument[];
  connections: McpConnectionDocument[];
}

type UnknownRecord = Record<string, unknown>;

const REGISTRY_SOURCE_KINDS = new Set<McpConnectionsRegistrySourceKind>([
  "official",
  "organization",
  "community",
  "custom",
]);
const REGISTRY_AUTH_TYPES = new Set<McpConnectionsRegistryAuthType>([
  "none",
  "bearer",
  "header",
]);
const INVOCATION_POLICIES = new Set<McpConnectionInvocationPolicy>([
  "automatic",
  "confirm_each_time",
]);
const TOP_LEVEL_FIELDS = new Set([
  "format",
  "version",
  "exported_at",
  "registry_sources",
  "connections",
]);
const TOOL_POLICY_FIELDS = new Set([
  "name",
  "schema_hash",
  "enabled",
  "invocation_policy",
]);
const CONNECTION_FIELDS = new Set([
  "name",
  "url",
  "transport",
  "enabled",
  "scope",
  "tools",
]);
const REGISTRY_SOURCE_FIELDS = new Set([
  "kind",
  "name",
  "base_url",
  "enabled",
  "priority",
  "auth_type",
  "auth_header_name",
  "credential_required",
]);
const UTC_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(
  value: UnknownRecord,
  expected: ReadonlySet<string>,
): boolean {
  return (
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key))
  );
}

function boundedString(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function isUtcDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = UTC_DATETIME_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  const parsed = new Date(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    year >= 1 &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day &&
    parsed.getUTCHours() === hour &&
    parsed.getUTCMinutes() === minute &&
    parsed.getUTCSeconds() === second
  );
}

function parseToolPolicy(value: unknown): McpConnectionToolPolicyDocument {
  if (
    !isRecord(value) ||
    !hasExactFields(value, TOOL_POLICY_FIELDS) ||
    !boundedString(value.name, 1, 256) ||
    typeof value.schema_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.schema_hash) ||
    typeof value.enabled !== "boolean" ||
    typeof value.invocation_policy !== "string" ||
    !INVOCATION_POLICIES.has(
      value.invocation_policy as McpConnectionInvocationPolicy,
    )
  ) {
    throw new TypeError("Invalid MCP Connections tool policy");
  }
  return {
    name: value.name,
    schema_hash: value.schema_hash,
    enabled: value.enabled,
    invocation_policy:
      value.invocation_policy as McpConnectionInvocationPolicy,
  };
}

function parseConnection(value: unknown): McpConnectionDocument {
  if (
    !isRecord(value) ||
    !hasExactFields(value, CONNECTION_FIELDS) ||
    !boundedString(value.name, 1, 64) ||
    !boundedString(value.url, 1, 2048) ||
    value.transport !== "streamable-http" ||
    typeof value.enabled !== "boolean" ||
    !(
      value.scope === null ||
      (typeof value.scope === "string" && value.scope.length <= 4096)
    ) ||
    !Array.isArray(value.tools) ||
    value.tools.length > MAX_MCP_CONNECTION_TOOL_POLICIES
  ) {
    throw new TypeError("Invalid MCP Connections connection");
  }
  const tools = value.tools.map(parseToolPolicy);
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new TypeError("Duplicate MCP Connections tool policy name");
  }
  return {
    name: value.name,
    url: value.url,
    transport: "streamable-http",
    enabled: value.enabled,
    scope: value.scope,
    tools,
  };
}

function parseRegistrySource(
  value: unknown,
): McpConnectionsRegistrySourceDocument {
  if (
    !isRecord(value) ||
    !hasExactFields(value, REGISTRY_SOURCE_FIELDS) ||
    typeof value.kind !== "string" ||
    !REGISTRY_SOURCE_KINDS.has(
      value.kind as McpConnectionsRegistrySourceKind,
    ) ||
    !boundedString(value.name, 1, 120) ||
    !boundedString(value.base_url, 1, 2048) ||
    typeof value.enabled !== "boolean" ||
    !Number.isInteger(value.priority) ||
    Number(value.priority) < -1000 ||
    Number(value.priority) > 1000 ||
    typeof value.auth_type !== "string" ||
    !REGISTRY_AUTH_TYPES.has(
      value.auth_type as McpConnectionsRegistryAuthType,
    ) ||
    !(
      value.auth_header_name === null ||
      boundedString(value.auth_header_name, 1, 128)
    ) ||
    typeof value.credential_required !== "boolean"
  ) {
    throw new TypeError("Invalid MCP Connections Registry source");
  }
  const authenticationIsConsistent =
    (value.auth_type === "none" &&
      value.auth_header_name === null &&
      !value.credential_required) ||
    (value.auth_type === "bearer" &&
      value.auth_header_name === null &&
      value.credential_required) ||
    (value.auth_type === "header" &&
      typeof value.auth_header_name === "string" &&
      value.credential_required);
  if (
    !authenticationIsConsistent ||
    (value.kind === "official" &&
      (value.base_url !== "https://registry.modelcontextprotocol.io" ||
        value.auth_type !== "none"))
  ) {
    throw new TypeError("Inconsistent MCP Connections Registry source");
  }
  return {
    kind: value.kind as McpConnectionsRegistrySourceKind,
    name: value.name,
    base_url: value.base_url,
    enabled: value.enabled,
    priority: Number(value.priority),
    auth_type: value.auth_type as McpConnectionsRegistryAuthType,
    auth_header_name: value.auth_header_name,
    credential_required: value.credential_required,
  };
}

export function parseMcpConnectionsDocument(
  value: unknown,
): McpConnectionsDocument {
  if (
    !isRecord(value) ||
    !hasExactFields(value, TOP_LEVEL_FIELDS) ||
    value.format !== MCP_CONNECTIONS_EXPORT_FORMAT ||
    value.version !== MCP_CONNECTIONS_EXPORT_VERSION ||
    !isUtcDateTime(value.exported_at) ||
    !Array.isArray(value.registry_sources) ||
    value.registry_sources.length > MAX_MCP_CONNECTIONS_REGISTRY_SOURCES ||
    !Array.isArray(value.connections) ||
    value.connections.length > MAX_MCP_CONNECTIONS
  ) {
    throw new TypeError("Invalid MCP Connections document");
  }
  const registrySources = value.registry_sources.map(parseRegistrySource);
  const connections = value.connections.map(parseConnection);
  if (
    new Set(registrySources.map((source) => source.base_url)).size !==
      registrySources.length ||
    new Set(connections.map((connection) => connection.name)).size !==
      connections.length
  ) {
    throw new TypeError("Duplicate MCP Connections identity");
  }
  const toolPolicyCount = connections.reduce(
    (count, connection) => count + connection.tools.length,
    0,
  );
  if (toolPolicyCount > MAX_MCP_CONNECTION_TOOL_POLICIES) {
    throw new TypeError("Too many MCP Connections tool policies");
  }
  return {
    format: MCP_CONNECTIONS_EXPORT_FORMAT,
    version: MCP_CONNECTIONS_EXPORT_VERSION,
    exported_at: value.exported_at,
    registry_sources: registrySources,
    connections,
  };
}
