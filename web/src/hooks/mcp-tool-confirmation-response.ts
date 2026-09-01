import {
  isBoundedMcpToolConfirmationArguments,
  MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_SERVER_ID_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATION_TIMESTAMP_CHARACTERS,
  MAX_MCP_TOOL_CONFIRMATIONS_PER_RESPONSE,
} from "takos-api-contract/shared/types";
import type { McpToolConfirmation } from "../types/index.ts";
import type { McpConfirmationRunGrant } from "./mcp-confirmation-run-grants.ts";

const CONFIRMATION_FIELDS = new Set([
  "id",
  "server_id",
  "server_name",
  "tool_name",
  "schema_hash",
  "arguments",
  "requested_run_id",
  "requested_thread_id",
  "status",
  "expires_at",
  "created_at",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactFields(
  value: Record<string, unknown>,
  expected: Set<string>,
): boolean {
  const fields = Object.keys(value);
  return fields.length === expected.size &&
    fields.every((field) => expected.has(field));
}

function boundedString(
  value: unknown,
  field: string,
  maxCharacters: number,
): string {
  if (
    typeof value !== "string" || !value.trim() ||
    value.length > maxCharacters
  ) {
    throw new TypeError(`Invalid MCP confirmation ${field}`);
  }
  return value;
}

function opaqueId(value: unknown, field: string): string {
  const id = boundedString(
    value,
    field,
    MAX_MCP_TOOL_CONFIRMATION_ID_CHARACTERS,
  );
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new TypeError(`Invalid MCP confirmation ${field}`);
  }
  return id;
}

function timestamp(value: unknown, field: string): string {
  const text = boundedString(
    value,
    field,
    MAX_MCP_TOOL_CONFIRMATION_TIMESTAMP_CHARACTERS,
  );
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`Invalid MCP confirmation ${field}`);
  }
  return text;
}

function parseConfirmation(value: unknown): McpToolConfirmation {
  const candidate = record(value);
  if (
    !candidate || !exactFields(candidate, CONFIRMATION_FIELDS) ||
    (candidate.status !== "pending" && candidate.status !== "approved") ||
    typeof candidate.schema_hash !== "string" ||
    !/^[a-f0-9]{64}$/.test(candidate.schema_hash) ||
    !isBoundedMcpToolConfirmationArguments(candidate.arguments)
  ) {
    throw new TypeError("Invalid MCP tool confirmation response");
  }
  const createdAt = timestamp(candidate.created_at, "created_at");
  const expiresAt = timestamp(candidate.expires_at, "expires_at");
  if (expiresAt <= createdAt) {
    throw new TypeError("Invalid MCP confirmation expiry");
  }
  return {
    id: opaqueId(candidate.id, "id"),
    server_id: boundedString(
      candidate.server_id,
      "server_id",
      MAX_MCP_TOOL_CONFIRMATION_SERVER_ID_CHARACTERS,
    ),
    server_name: boundedString(
      candidate.server_name,
      "server_name",
      MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS,
    ),
    tool_name: boundedString(
      candidate.tool_name,
      "tool_name",
      MAX_MCP_TOOL_CONFIRMATION_NAME_CHARACTERS,
    ),
    schema_hash: candidate.schema_hash,
    arguments: candidate.arguments,
    requested_run_id: opaqueId(candidate.requested_run_id, "requested_run_id"),
    requested_thread_id: opaqueId(
      candidate.requested_thread_id,
      "requested_thread_id",
    ),
    status: candidate.status,
    expires_at: expiresAt,
    created_at: createdAt,
  };
}

export function parseMcpToolConfirmationsResponse(
  value: unknown,
): { confirmations: McpToolConfirmation[]; truncated: boolean } {
  const candidate = record(value);
  if (
    !candidate || !exactFields(candidate, new Set(["data", "truncated"])) ||
    !Array.isArray(candidate.data) ||
    candidate.data.length > MAX_MCP_TOOL_CONFIRMATIONS_PER_RESPONSE ||
    typeof candidate.truncated !== "boolean"
  ) {
    throw new TypeError("Invalid MCP tool confirmation inventory response");
  }
  const confirmations = candidate.data.map(parseConfirmation);
  if (
    new Set(confirmations.map((confirmation) => confirmation.id)).size !==
      confirmations.length
  ) {
    throw new TypeError("Duplicate MCP tool confirmation identity");
  }
  return { confirmations, truncated: candidate.truncated };
}

export function parseMcpToolConfirmationDecisionResponse(
  value: unknown,
  expectedDecision: "approve" | "deny",
  expected: {
    confirmationId: string;
    workspaceId: string;
    threadId: string;
    expiresAt: string;
  },
): McpConfirmationRunGrant | null {
  const candidate = record(value);
  const data = candidate && record(candidate.data);
  const expectedStatus = expectedDecision === "approve" ? "approved" : "denied";
  if (
    !candidate || !exactFields(candidate, new Set(["data"])) || !data ||
    data.status !== expectedStatus
  ) {
    throw new TypeError(
      "MCP confirmation response does not match the decision",
    );
  }
  if (expectedDecision === "deny") {
    if (!exactFields(data, new Set(["status"]))) {
      throw new TypeError("Invalid MCP confirmation denial response");
    }
    return null;
  }
  if (
    !exactFields(
      data,
      new Set([
        "status",
        "confirmation_grant_id",
        "requested_thread_id",
        "expires_at",
      ]),
    ) ||
    opaqueId(data.confirmation_grant_id, "grant id") !==
      expected.confirmationId ||
    opaqueId(data.requested_thread_id, "requested_thread_id") !==
      expected.threadId ||
    timestamp(data.expires_at, "expires_at") !== expected.expiresAt
  ) {
    throw new TypeError("Invalid MCP confirmation approval grant");
  }
  return {
    confirmationGrantId: expected.confirmationId,
    workspaceId: opaqueId(expected.workspaceId, "Workspace id"),
    threadId: expected.threadId,
    expiresAt: expected.expiresAt,
  };
}
