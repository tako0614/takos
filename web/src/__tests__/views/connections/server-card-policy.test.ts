import { describe, expect, test } from "bun:test";
import {
  buildMcpToolPolicyPatch,
  buildMcpToolPolicyPath,
} from "../../../hooks/mcp-server-paths.ts";
import type {
  McpAuthorizationStatus,
  McpServerRecord,
  McpServerTool,
} from "../../../types/index.ts";
import {
  canUpdateToolPolicy,
  getServerAuthLabelKey,
  getServerSourceLabelKey,
  getServerStatus,
} from "../../../views/hub/server-card-policy.ts";

function server(
  authorizationStatus: McpAuthorizationStatus,
  overrides: Partial<McpServerRecord> = {},
): McpServerRecord {
  return {
    id: "server_a",
    name: "Example",
    url: "https://connector.example/mcp",
    source_type: "external",
    auth_mode: "oauth_pkce",
    authorization_status: authorizationStatus,
    token_expires_at: null,
    enabled: true,
    ...overrides,
  };
}

function tool(overrides: Partial<McpServerTool> = {}): McpServerTool {
  return {
    name: "docs.read",
    description: "Read a document",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    execution: null,
    supported: true,
    unsupported_reason: null,
    enabled: false,
    review_required: true,
    schema_hash: "a".repeat(64),
    policy_read_only: false,
    reviewed_at: null,
    first_seen_at: "2026-07-11T00:00:00.000Z",
    last_seen_at: "2026-07-11T00:00:00.000Z",
    risk_level: "low",
    side_effects: false,
    invocation_policy: "confirm_each_time",
    ...overrides,
  };
}

describe("Connections MCP server policy view", () => {
  test("uses the backend authorization status, including no-expiry tokens", () => {
    expect(getServerStatus(server("authorized"))).toBe("connected");
    expect(getServerStatus(server("not_required"))).toBe("connected");
    expect(getServerStatus(server("managed"))).toBe("connected");
    expect(getServerStatus(server("authorization_required"))).toBe("no_token");
    expect(getServerStatus(server("reauthorization_required"))).toBe(
      "token_expired",
    );
    expect(getServerStatus(server("authorized", { enabled: false }))).toBe(
      "disabled",
    );
  });

  test("only external mutable policies can be changed", () => {
    expect(canUpdateToolPolicy(server("authorized"), tool())).toBe(true);
    expect(
      canUpdateToolPolicy(
        server("managed", { source_type: "publication" }),
        tool({ policy_read_only: true, enabled: true }),
      ),
    ).toBe(false);
    expect(
      canUpdateToolPolicy(
        server("authorized"),
        tool({
          execution: { taskSupport: "required" },
          supported: false,
          unsupported_reason: "task_execution_required",
        }),
      ),
    ).toBe(false);
  });

  test("uses product-true publication and OIDC labels", () => {
    expect(getServerSourceLabelKey("publication")).toBe(
      "connectionSourceCapsulePublished",
    );
    expect(getServerAuthLabelKey("takos_oidc")).toBe(
      "connectionAuthWorkspaceOidc",
    );
    expect(getServerSourceLabelKey("bundle_deployment")).toBe(
      "connectionSourceProjected",
    );
  });

  test("encodes server, tool, and Workspace identifiers in policy URLs", () => {
    expect(buildMcpToolPolicyPath("server/id", "docs/read", "space/id")).toBe(
      "/api/mcp/servers/server%2Fid/tools/docs%2Fread?workspaceId=space%2Fid",
    );
  });

  test("pins policy updates to the schema that the user reviewed", () => {
    expect(
      buildMcpToolPolicyPatch(true, "a".repeat(64), "confirm_each_time"),
    ).toEqual({
      enabled: true,
      schema_hash: "a".repeat(64),
      invocation_policy: "confirm_each_time",
    });
  });
});
