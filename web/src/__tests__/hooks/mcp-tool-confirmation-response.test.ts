import { describe, expect, test } from "bun:test";
import {
  parseMcpToolConfirmationDecisionResponse,
  parseMcpToolConfirmationsResponse,
} from "../../hooks/mcp-tool-confirmation-response.ts";
import type { McpToolConfirmation } from "../../types/index.ts";

const createdAt = "2026-08-10T15:00:00.000Z";
const expiresAt = "2026-08-10T15:10:00.000Z";

function confirmation(
  overrides: Record<string, unknown> = {},
): McpToolConfirmation & Record<string, unknown> {
  return {
    id: "confirmation_1",
    server_id: "publication:capsule_output_1",
    server_name: "Documents",
    tool_name: "docs.read",
    schema_hash: "a".repeat(64),
    arguments: { id: "doc_1", options: { mode: "raw" } },
    requested_run_id: "run_1",
    requested_thread_id: "thread_1",
    status: "pending",
    expires_at: expiresAt,
    created_at: createdAt,
    ...overrides,
  } as McpToolConfirmation & Record<string, unknown>;
}

describe("MCP tool confirmation response authority", () => {
  test("accepts and projects one bounded pending invocation", () => {
    expect(parseMcpToolConfirmationsResponse({
      data: [confirmation()],
      truncated: false,
    })).toEqual({
      confirmations: [confirmation()],
      truncated: false,
    });
  });

  test("accepts recoverable approvals and rejects incomplete or duplicate records", () => {
    expect(() => parseMcpToolConfirmationsResponse({ data: [] })).toThrow(
      TypeError,
    );
    expect(() =>
      parseMcpToolConfirmationsResponse({
        data: [confirmation({ extra: true })],
        truncated: false,
      })
    ).toThrow(TypeError);
    expect(() =>
      parseMcpToolConfirmationsResponse({
        data: [confirmation(), confirmation()],
        truncated: false,
      })
    ).toThrow("Duplicate MCP tool confirmation identity");
    expect(
      parseMcpToolConfirmationsResponse({
        data: [confirmation({ status: "approved" })],
        truncated: false,
      }).confirmations[0]?.status,
    ).toBe("approved");
    expect(() =>
      parseMcpToolConfirmationsResponse({
        data: [confirmation({ status: "consumed" })],
        truncated: false,
      })
    ).toThrow(TypeError);
  });

  test("rejects unsafe argument depth and schema or expiry drift", () => {
    let argumentsValue: Record<string, unknown> = {};
    for (let depth = 0; depth < 34; depth += 1) {
      argumentsValue = { child: argumentsValue };
    }
    expect(() =>
      parseMcpToolConfirmationsResponse({
        data: [confirmation({ arguments: argumentsValue })],
        truncated: false,
      })
    ).toThrow(TypeError);
    expect(() =>
      parseMcpToolConfirmationsResponse({
        data: [confirmation({ schema_hash: "reviewed" })],
        truncated: false,
      })
    ).toThrow(TypeError);
    expect(() =>
      parseMcpToolConfirmationsResponse({
        data: [confirmation({ expires_at: createdAt })],
        truncated: false,
      })
    ).toThrow("Invalid MCP confirmation expiry");
  });

  test("accepts only the exact status requested by the decision", () => {
    const expected = {
      confirmationId: "confirmation_1",
      workspaceId: "workspace_1",
      threadId: "thread_1",
      expiresAt,
    };
    expect(parseMcpToolConfirmationDecisionResponse(
      {
        data: {
          status: "approved",
          confirmation_grant_id: "confirmation_1",
          requested_thread_id: "thread_1",
          expires_at: expiresAt,
        },
      },
      "approve",
      expected,
    )).toEqual({
      confirmationGrantId: "confirmation_1",
      workspaceId: "workspace_1",
      threadId: "thread_1",
      expiresAt,
    });
    expect(parseMcpToolConfirmationDecisionResponse(
      { data: { status: "denied" } },
      "deny",
      expected,
    )).toBeNull();
    expect(() =>
      parseMcpToolConfirmationDecisionResponse(
        { data: { status: "denied" } },
        "approve",
        expected,
      )
    ).toThrow("MCP confirmation response does not match the decision");
    expect(() =>
      parseMcpToolConfirmationDecisionResponse(
        { data: { status: "approved", id: "wrong" } },
        "approve",
        expected,
      )
    ).toThrow(TypeError);
  });
});
