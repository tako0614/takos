import type { McpServerRecord, McpServerTool } from "../../types/index.ts";
import {
  MAX_MCP_CONNECTIONS_DOCUMENT_BYTES,
  MAX_MCP_CONNECTIONS,
  MAX_MCP_CONNECTIONS_REGISTRY_SOURCES,
  MAX_MCP_CONNECTION_TOOL_POLICIES,
  parseMcpConnectionsDocument,
  type McpConnectionsDocument,
} from "takos-api-contract/mcp-connections";

export { MAX_MCP_CONNECTIONS_DOCUMENT_BYTES } from "takos-api-contract/mcp-connections";

const AUTHORIZATION_STATUSES = new Set([
  "not_required",
  "authorized",
  "authorization_required",
  "reauthorization_required",
  "managed",
]);
const MCP_SERVER_ACTION_STATUSES = new Set([
  "registered",
  "already_registered",
  "pending_oauth",
]);
const INVOCATION_POLICIES = new Set(["automatic", "confirm_each_time"]);
const RISK_LEVELS = new Set(["none", "low", "medium", "high"]);
const IMPORT_CONNECTION_STATUSES = new Set([
  "registered",
  "already_registered",
  "pending_oauth",
  "failed",
]);
const IMPORT_REGISTRY_STATUSES = new Set([
  "created",
  "updated",
  "credential_required",
  "failed",
]);
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const SCHEMA_HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MCP_SERVERS = 500;
const MAX_MCP_TOOLS = 500;
const MAX_MCP_TOOLS_RESPONSE_BYTES = 4 * 1024 * 1024;
const SERVER_ACTION_KEYS = new Set([
  "status",
  "name",
  "url",
  "auth_url",
  "message",
]);
const TOOL_ANNOTATION_KEYS = new Set([
  "title",
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
]);
const TOOL_EXECUTION_KEYS = new Set(["taskSupport"]);
const IMPORT_REGISTRY_RESULT_KEYS = new Set([
  "base_url",
  "status",
  "message",
]);
const IMPORT_CONNECTION_RESULT_KEYS = new Set([
  "name",
  "url",
  "status",
  "authorization_url",
  "tool_policies_require_review",
  "message",
]);

const SERVER_RESPONSE_KEYS = new Set([
  "id",
  "name",
  "url",
  "transport",
  "enabled",
  "source_type",
  "auth_mode",
  "service_id",
  "bundle_deployment_id",
  "managed",
  "scope",
  "issuer_url",
  "registration_mode",
  "authorization_status",
  "token_expires_at",
  "created_at",
  "updated_at",
]);
const TOOL_RESPONSE_KEYS = new Set([
  "name",
  "description",
  "inputSchema",
  "annotations",
  "execution",
  "supported",
  "unsupported_reason",
  "enabled",
  "invocation_policy",
  "review_required",
  "schema_hash",
  "policy_read_only",
  "reviewed_at",
  "first_seen_at",
  "last_seen_at",
  "risk_level",
  "side_effects",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function hasExactKeys(value: UnknownRecord, expected: readonly string[]) {
  return (
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function isBoundedString(
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxLength &&
    (allowEmpty || value.trim().length > 0)
  );
}

function isOptionalBoundedString(value: unknown, maxLength: number): boolean {
  return (
    value === undefined ||
    value === null ||
    isBoundedString(value, maxLength)
  );
}

function parseEndpointUrl(value: unknown): string {
  if (!isBoundedString(value, 4096)) {
    throw new Error("Invalid MCP endpoint URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid MCP endpoint URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Invalid MCP endpoint URL");
  }
  return url.href;
}

function projectOptionalString(
  source: UnknownRecord,
  key: string,
): string | null | undefined {
  const value = source[key];
  return typeof value === "string" || value === null ? value : undefined;
}

function readData(value: unknown): unknown {
  if (!isRecord(value) || !hasExactKeys(value, ["data"])) {
    throw new Error("Invalid MCP response");
  }
  return value.data;
}

export function parseConnectionsExportResponse(
  value: unknown,
): McpConnectionsDocument {
  return parseMcpConnectionsDocument(readData(value));
}

export function serializeConnectionsExportDocument(value: unknown): string {
  const document = parseMcpConnectionsDocument(value);
  const serialized = JSON.stringify(document, null, 2);
  if (
    new TextEncoder().encode(serialized).byteLength >
      MAX_MCP_CONNECTIONS_DOCUMENT_BYTES
  ) {
    throw new TypeError("MCP Connections document exceeds the import limit");
  }
  return serialized;
}

function parseServerRecord(value: unknown): McpServerRecord {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, SERVER_RESPONSE_KEYS) ||
    !hasExactKeys(value, [...SERVER_RESPONSE_KEYS]) ||
    !isBoundedString(value.id, 256) ||
    !isBoundedString(value.name, 256) ||
    !isBoundedString(value.transport, 64) ||
    !isBoundedString(value.source_type, 64) ||
    !isBoundedString(value.auth_mode, 64) ||
    typeof value.enabled !== "boolean" ||
    typeof value.managed !== "boolean" ||
    typeof value.authorization_status !== "string" ||
    !AUTHORIZATION_STATUSES.has(value.authorization_status) ||
    !isOptionalBoundedString(value.token_expires_at, 64) ||
    !isOptionalBoundedString(value.scope, 4096) ||
    !isOptionalBoundedString(value.issuer_url, 4096) ||
    !isOptionalBoundedString(value.registration_mode, 64) ||
    !isOptionalBoundedString(value.service_id, 256) ||
    !isOptionalBoundedString(value.bundle_deployment_id, 256) ||
    !isBoundedString(value.created_at, 64) ||
    !isBoundedString(value.updated_at, 64)
  ) {
    throw new Error("Invalid MCP server record");
  }
  if (value.managed !== (value.source_type !== "external")) {
    throw new Error("Invalid MCP server authority");
  }
  const url = parseEndpointUrl(value.url);
  return {
    id: value.id,
    name: value.name,
    url,
    transport: value.transport,
    source_type: value.source_type,
    auth_mode: value.auth_mode,
    enabled: value.enabled,
    managed: value.managed,
    authorization_status:
      value.authorization_status as McpServerRecord["authorization_status"],
    service_id: projectOptionalString(value, "service_id"),
    bundle_deployment_id: projectOptionalString(
      value,
      "bundle_deployment_id",
    ),
    scope: projectOptionalString(value, "scope"),
    issuer_url: projectOptionalString(value, "issuer_url"),
    token_expires_at: projectOptionalString(value, "token_expires_at"),
    created_at: value.created_at,
    updated_at: value.updated_at,
  };
}

export function parseMcpServersResponse(value: unknown): McpServerRecord[] {
  const data = readData(value);
  if (!Array.isArray(data) || data.length > MAX_MCP_SERVERS) {
    throw new Error("Invalid MCP server inventory response");
  }
  let servers: McpServerRecord[];
  try {
    servers = data.map(parseServerRecord);
  } catch {
    throw new Error("Invalid MCP server inventory response");
  }
  const ids = new Set(servers.map((server) => server.id));
  if (ids.size !== servers.length) {
    throw new Error("Invalid MCP server inventory response");
  }
  return servers;
}

export function parseMcpServerResponse(
  value: unknown,
  expectedServerId?: string,
): McpServerRecord {
  const data = readData(value);
  let server: McpServerRecord;
  try {
    server = parseServerRecord(data);
  } catch {
    throw new Error("Invalid MCP server response");
  }
  if (expectedServerId !== undefined && server.id !== expectedServerId) {
    throw new Error("Invalid MCP server response");
  }
  return server;
}

export function parseMcpServerDeleteResponse(value: unknown): true {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["success"]) ||
    value.success !== true
  ) {
    throw new Error("Invalid MCP server delete response");
  }
  return true;
}

export function isMcpOAuthAuthorizationComplete(
  server: McpServerRecord,
): boolean {
  return server.authorization_status === "authorized";
}

function isToolAnnotations(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, TOOL_ANNOTATION_KEYS) &&
    isOptionalBoundedString(value.title, 256) &&
    (value.readOnlyHint === undefined ||
      typeof value.readOnlyHint === "boolean") &&
    (value.destructiveHint === undefined ||
      typeof value.destructiveHint === "boolean") &&
    (value.idempotentHint === undefined ||
      typeof value.idempotentHint === "boolean") &&
    (value.openWorldHint === undefined ||
      typeof value.openWorldHint === "boolean")
  );
}

function isToolExecution(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  return (
    hasOnlyKeys(value, TOOL_EXECUTION_KEYS) &&
    (value.taskSupport === undefined ||
      value.taskSupport === "forbidden" ||
      value.taskSupport === "optional" ||
      value.taskSupport === "required")
  );
}

function parseServerTool(value: unknown): McpServerTool {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [...TOOL_RESPONSE_KEYS]) ||
    !isBoundedString(value.name, 256) ||
    !isBoundedString(value.description, 8192, true) ||
    !isToolAnnotations(value.annotations) ||
    !isToolExecution(value.execution) ||
    typeof value.supported !== "boolean" ||
    (value.unsupported_reason !== null &&
      value.unsupported_reason !== "task_execution_required") ||
    typeof value.enabled !== "boolean" ||
    typeof value.review_required !== "boolean" ||
    typeof value.schema_hash !== "string" ||
    !SCHEMA_HASH_PATTERN.test(value.schema_hash) ||
    typeof value.policy_read_only !== "boolean" ||
    !isOptionalBoundedString(value.reviewed_at, 64) ||
    !isOptionalBoundedString(value.first_seen_at, 64) ||
    !isOptionalBoundedString(value.last_seen_at, 64) ||
    typeof value.risk_level !== "string" ||
    !RISK_LEVELS.has(value.risk_level) ||
    typeof value.side_effects !== "boolean" ||
    typeof value.invocation_policy !== "string" ||
    !INVOCATION_POLICIES.has(value.invocation_policy)
  ) {
    throw new Error("Invalid MCP tool record");
  }
  const annotations = value.annotations as McpServerTool["annotations"];
  const execution = value.execution as McpServerTool["execution"];
  return {
    name: value.name,
    description: value.description,
    inputSchema: value.inputSchema,
    annotations: annotations === null ? null : { ...annotations },
    execution: execution === null ? null : { ...execution },
    supported: value.supported,
    unsupported_reason: value.unsupported_reason,
    enabled: value.enabled,
    review_required: value.review_required,
    schema_hash: value.schema_hash,
    policy_read_only: value.policy_read_only,
    reviewed_at: projectOptionalString(value, "reviewed_at") ?? null,
    first_seen_at: projectOptionalString(value, "first_seen_at") ?? null,
    last_seen_at: projectOptionalString(value, "last_seen_at") ?? null,
    risk_level: value.risk_level,
    side_effects: value.side_effects,
    invocation_policy:
      value.invocation_policy as McpServerTool["invocation_policy"],
  };
}

export function parseMcpServerToolsResponse(value: unknown): McpServerTool[] {
  const data = readData(value);
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ["tools"]) ||
    !Array.isArray(data.tools) ||
    data.tools.length > MAX_MCP_TOOLS
  ) {
    throw new Error("Invalid MCP tools response");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    throw new Error("Invalid MCP tools response");
  }
  if (
    new TextEncoder().encode(serialized).byteLength >
      MAX_MCP_TOOLS_RESPONSE_BYTES
  ) {
    throw new Error("Invalid MCP tools response");
  }
  let tools: McpServerTool[];
  try {
    tools = data.tools.map(parseServerTool);
  } catch {
    throw new Error("Invalid MCP tool record");
  }
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    throw new Error("Invalid MCP tools response");
  }
  return tools;
}

export function parseMcpServerToolResponse(
  value: unknown,
  expected?: { toolName: string; schemaHash: string },
): McpServerTool {
  const data = readData(value);
  let tool: McpServerTool;
  try {
    tool = parseServerTool(data);
  } catch {
    throw new Error("Invalid MCP tool response");
  }
  if (
    expected &&
    (tool.name !== expected.toolName || tool.schema_hash !== expected.schemaHash)
  ) {
    throw new Error("Invalid MCP tool response");
  }
  return tool;
}

export interface McpServerActionResult {
  status: string;
  name: string;
  url: string;
  auth_url?: string;
  message: string;
}

export function parseAuthorizationUrl(
  value: unknown,
  expectedOrigin?: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("Invalid MCP authorization URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Invalid MCP authorization URL");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password ||
    (expectedOrigin !== undefined && url.origin !== expectedOrigin) ||
    url.pathname !== "/api/mcp/oauth/start" ||
    !OAUTH_STATE_PATTERN.test(url.searchParams.get("state") ?? "") ||
    url.hash
  ) {
    throw new Error("Invalid MCP authorization URL");
  }
  return url.href;
}

export function parseMcpServerActionResponse(
  value: unknown,
  expectedOrigin?: string,
  expected?: { name: string; url: string },
): McpServerActionResult {
  const data = readData(value);
  if (
    !isRecord(data) ||
    !hasOnlyKeys(data, SERVER_ACTION_KEYS) ||
    !isBoundedString(data.status, 32) ||
    !MCP_SERVER_ACTION_STATUSES.has(data.status) ||
    !isBoundedString(data.name, 256) ||
    !isBoundedString(data.message, 2048)
  ) {
    throw new Error("Invalid MCP server action response");
  }
  const url = parseEndpointUrl(data.url);
  if (
    expected &&
    (data.name !== expected.name || url !== parseEndpointUrl(expected.url))
  ) {
    throw new Error("Invalid MCP server action response");
  }
  const authUrl = parseAuthorizationUrl(data.auth_url, expectedOrigin);
  if ((data.status === "pending_oauth") !== (authUrl !== undefined)) {
    throw new Error("Invalid MCP server action response");
  }
  return {
    status: data.status,
    name: data.name,
    url,
    message: data.message,
    ...(authUrl ? { auth_url: authUrl } : {}),
  };
}

export interface ConnectionsImportResult {
  registry_sources: Array<{
    base_url: string;
    status: string;
    message?: string;
  }>;
  connections: Array<{
    name: string;
    url: string;
    status: string;
    authorization_url?: string;
    tool_policies_require_review: number;
    message?: string;
  }>;
}

export function parseConnectionsImportResponse(
  value: unknown,
  expectedOrigin?: string,
  expectedDocument?: McpConnectionsDocument,
): ConnectionsImportResult {
  const data = readData(value);
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ["registry_sources", "connections"]) ||
    !Array.isArray(data.registry_sources) ||
    data.registry_sources.length > MAX_MCP_CONNECTIONS_REGISTRY_SOURCES ||
    !Array.isArray(data.connections) ||
    data.connections.length > MAX_MCP_CONNECTIONS
  ) {
    throw new Error("Invalid Connections import response");
  }
  const registrySources = data.registry_sources.map((entry) => {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, IMPORT_REGISTRY_RESULT_KEYS) ||
      !isBoundedString(entry.base_url, 2048) ||
      typeof entry.status !== "string" ||
      !IMPORT_REGISTRY_STATUSES.has(entry.status) ||
      !isOptionalBoundedString(entry.message, 2048)
    ) {
      throw new Error("Invalid Connections Registry import result");
    }
    return {
      base_url: entry.base_url,
      status: entry.status,
      ...(typeof entry.message === "string"
        ? { message: entry.message }
        : {}),
    };
  });
  const connections = data.connections.map((entry) => {
    if (
      !isRecord(entry) ||
      !hasOnlyKeys(entry, IMPORT_CONNECTION_RESULT_KEYS) ||
      !isBoundedString(entry.name, 64) ||
      typeof entry.status !== "string" ||
      !IMPORT_CONNECTION_STATUSES.has(entry.status) ||
      !Number.isInteger(entry.tool_policies_require_review) ||
      Number(entry.tool_policies_require_review) < 0 ||
      Number(entry.tool_policies_require_review) >
        MAX_MCP_CONNECTION_TOOL_POLICIES ||
      !isOptionalBoundedString(entry.message, 2048)
    ) {
      throw new Error("Invalid Connections import result");
    }
    const url = parseEndpointUrl(entry.url);
    const authorizationUrl = parseAuthorizationUrl(
      entry.authorization_url,
      expectedOrigin,
    );
    if (
      (entry.status === "pending_oauth") !==
        (authorizationUrl !== undefined)
    ) {
      throw new Error("Invalid Connections import result");
    }
    return {
      name: entry.name,
      url,
      status: entry.status,
      tool_policies_require_review: Number(
        entry.tool_policies_require_review,
      ),
      ...(authorizationUrl ? { authorization_url: authorizationUrl } : {}),
      ...(typeof entry.message === "string"
        ? { message: entry.message }
        : {}),
    };
  });
  if (
    new Set(registrySources.map((entry) => entry.base_url)).size !==
      registrySources.length ||
    new Set(connections.map((entry) => entry.name)).size !== connections.length
  ) {
    throw new Error("Invalid Connections import response");
  }
  if (expectedDocument) {
    const expectedRegistry = new Map(
      expectedDocument.registry_sources.map((source) => [
        source.base_url,
        source,
      ]),
    );
    const expectedConnections = new Map(
      expectedDocument.connections.map((connection) => [
        connection.name,
        connection,
      ]),
    );
    if (
      registrySources.length !== expectedRegistry.size ||
      connections.length !== expectedConnections.size ||
      registrySources.some((entry) => !expectedRegistry.has(entry.base_url)) ||
      connections.some((entry) => {
        const expected = expectedConnections.get(entry.name);
        return (
          !expected ||
          entry.url !== parseEndpointUrl(expected.url) ||
          entry.tool_policies_require_review !==
            expected.tools.filter((tool) => tool.enabled).length
        );
      })
    ) {
      throw new Error("Connections import response does not match the request");
    }
  }
  return { registry_sources: registrySources, connections };
}
