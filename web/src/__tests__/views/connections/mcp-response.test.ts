import { describe, expect, test } from "bun:test";
import type { McpConnectionsDocument } from "takos-api-contract/mcp-connections";
import type { McpServerRecord } from "../../../types/index.ts";
import {
  isMcpOAuthAuthorizationComplete,
  parseAuthorizationUrl,
  parseConnectionsExportResponse,
  parseConnectionsImportResponse,
  parseMcpServerActionResponse,
  parseMcpServerDeleteResponse,
  parseMcpServerResponse,
  parseMcpServerToolResponse,
  parseMcpServerToolsResponse,
  parseMcpServersResponse,
  serializeConnectionsExportDocument,
} from "../../../views/connections/mcp-response.ts";

function connectionsDocument(): McpConnectionsDocument {
  return {
    format: "takos.mcp.connections",
    version: 1,
    exported_at: "2026-08-10T00:00:00.000Z",
    registry_sources: [],
    connections: [
      {
        name: "docs",
        url: "https://connector.example/mcp",
        transport: "streamable-http",
        enabled: true,
        scope: null,
        tools: [],
      },
    ],
  };
}

function rawServer(overrides: Record<string, unknown> = {}) {
  return {
    id: "server-1",
    name: "docs",
    url: "https://connector.example/mcp",
    transport: "streamable-http",
    enabled: true,
    source_type: "external",
    auth_mode: "oauth_pkce",
    service_id: null,
    bundle_deployment_id: null,
    managed: false,
    scope: null,
    issuer_url: null,
    registration_mode: null,
    authorization_status: "authorized",
    token_expires_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function server(): McpServerRecord {
  return parseMcpServerResponse({ data: rawServer() });
}

function rawTool(overrides: Record<string, unknown> = {}) {
  return {
    name: "search",
    description: "Search documentation",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
    execution: { taskSupport: "forbidden" },
    supported: true,
    unsupported_reason: null,
    enabled: false,
    invocation_policy: "confirm_each_time",
    review_required: true,
    schema_hash: "a".repeat(64),
    policy_read_only: false,
    reviewed_at: null,
    first_seen_at: "2026-08-10T00:00:00.000Z",
    last_seen_at: "2026-08-10T00:00:00.000Z",
    risk_level: "low",
    side_effects: false,
    ...overrides,
  };
}

describe("MCP response validation", () => {
  test("accepts a valid server inventory and rejects malformed success", () => {
    const parsed = parseMcpServersResponse({ data: [rawServer()] });
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).not.toHaveProperty("registration_mode");
    expect(() => parseMcpServersResponse({ data: {} })).toThrow(
      "Invalid MCP server inventory response",
    );
    expect(() =>
      parseMcpServersResponse({
        data: [rawServer({ authorization_status: "surprise" })],
      }),
    ).toThrow("Invalid MCP server inventory response");
    expect(() =>
      parseMcpServersResponse({
        data: [rawServer(), rawServer()],
      }),
    ).toThrow("Invalid MCP server inventory response");
    expect(() =>
      parseMcpServersResponse({
        data: [rawServer({ unexpected: "authority-confusion" })],
      }),
    ).toThrow("Invalid MCP server inventory response");
    expect(() =>
      parseMcpServersResponse({
        data: [rawServer({ managed: true })],
      }),
    ).toThrow("Invalid MCP server inventory response");
    expect(() =>
      parseMcpServersResponse({
        data: [rawServer({ url: "javascript:alert(1)" })],
      }),
    ).toThrow("Invalid MCP server inventory response");
  });

  test("binds mutation responses to the requested resource identity", () => {
    expect(
      parseMcpServerResponse({ data: rawServer() }, "server-1").id,
    ).toBe("server-1");
    expect(() =>
      parseMcpServerResponse({ data: rawServer() }, "server-other"),
    ).toThrow("Invalid MCP server response");
    expect(
      parseMcpServerToolResponse(
        { data: rawTool() },
        { toolName: "search", schemaHash: "a".repeat(64) },
      ).name,
    ).toBe("search");
    expect(() =>
      parseMcpServerToolResponse(
        { data: rawTool({ name: "different" }) },
        { toolName: "search", schemaHash: "a".repeat(64) },
      ),
    ).toThrow("Invalid MCP tool response");
  });

  test("requires exact delete and action success envelopes", () => {
    expect(parseMcpServerDeleteResponse({ success: true })).toBe(true);
    expect(() =>
      parseMcpServerDeleteResponse({ success: false }),
    ).toThrow("Invalid MCP server delete response");
    expect(() =>
      parseMcpServerDeleteResponse({ success: true, data: {} }),
    ).toThrow("Invalid MCP server delete response");

    const action = {
      data: {
        status: "registered",
        name: "docs",
        url: "https://connector.example/mcp",
        message: "Connected",
      },
    };
    expect(
      parseMcpServerActionResponse(
        action,
        "https://takos.example",
        { name: "docs", url: "https://connector.example/mcp" },
      ).status,
    ).toBe("registered");
    expect(() =>
      parseMcpServerActionResponse({
        data: { ...action.data, status: "surprise" },
      }),
    ).toThrow("Invalid MCP server action response");
    expect(() =>
      parseMcpServerActionResponse({
        data: { ...action.data, status: "pending_oauth" },
      }),
    ).toThrow("Invalid MCP server action response");
    expect(() =>
      parseMcpServerActionResponse({
        data: {
          ...action.data,
          auth_url:
            "https://takos.example/api/mcp/oauth/start?state=" +
            "a".repeat(32),
        },
      }, "https://takos.example"),
    ).toThrow("Invalid MCP server action response");
  });

  test("rejects duplicate and surplus tool inventory identities", () => {
    expect(
      parseMcpServerToolsResponse({ data: { tools: [rawTool()] } }),
    ).toHaveLength(1);
    expect(() =>
      parseMcpServerToolsResponse({
        data: { tools: [rawTool(), rawTool()] },
      }),
    ).toThrow("Invalid MCP tools response");
    expect(() =>
      parseMcpServerToolsResponse({
        data: { tools: [rawTool({ extra: true })] },
      }),
    ).toThrow("Invalid MCP tool record");
  });

  test("an OAuth placeholder is not an authorized connection", () => {
    const placeholder = {
      ...server(),
      authorization_status: "authorization_required" as const,
    };
    expect(isMcpOAuthAuthorizationComplete(placeholder)).toBe(false);
    expect(isMcpOAuthAuthorizationComplete(server())).toBe(true);
  });

  test("rejects malformed tool-policy mutation responses", () => {
    expect(() =>
      parseMcpServerToolResponse({ data: { name: "unsafe-partial" } }),
    ).toThrow("Invalid MCP tool response");
  });

  test("accepts only bounded internal OAuth-start URLs", () => {
    const state = "a".repeat(32);
    expect(
      parseAuthorizationUrl(
        `https://takos.example/api/mcp/oauth/start?state=${state}`,
        "https://takos.example",
      ),
    ).toBe(`https://takos.example/api/mcp/oauth/start?state=${state}`);
    for (const unsafe of [
      "javascript:alert(1)",
      "https://user:secret@takos.example/api/mcp/oauth/start?state=" + state,
      "https://takos.example/other?state=" + state,
      "https://takos.example/api/mcp/oauth/start?state=short",
      "https://other.example/api/mcp/oauth/start?state=" + state,
    ]) {
      expect(() =>
        parseAuthorizationUrl(unsafe, "https://takos.example"),
      ).toThrow(
        "Invalid MCP authorization URL",
      );
    }
  });

  test("rejects unsafe authorization links in import results", () => {
    expect(() =>
      parseConnectionsImportResponse({
        data: {
          registry_sources: [],
          connections: [
            {
              name: "docs",
              url: "https://connector.example/mcp",
              status: "pending_oauth",
              authorization_url: "javascript:alert(1)",
              tool_policies_require_review: 1,
            },
          ],
        },
      }),
    ).toThrow("Invalid MCP authorization URL");
  });

  test("binds Connections import results to the imported document", () => {
    const document = connectionsDocument();
    const state = "a".repeat(32);
    const response = {
      data: {
        registry_sources: [],
        connections: [
          {
            name: "docs",
            url: "https://connector.example/mcp",
            status: "pending_oauth",
            authorization_url:
              `https://takos.example/api/mcp/oauth/start?state=${state}`,
            tool_policies_require_review: 0,
            message: "Authorize this connection",
          },
        ],
      },
    };
    expect(
      parseConnectionsImportResponse(
        response,
        "https://takos.example",
        document,
      ).connections[0],
    ).toMatchObject({
      name: "docs",
      url: "https://connector.example/mcp",
      status: "pending_oauth",
    });
    expect(() =>
      parseConnectionsImportResponse(
        {
          data: {
            ...response.data,
            connections: [
              { ...response.data.connections[0], name: "calendar" },
            ],
          },
        },
        "https://takos.example",
        document,
      ),
    ).toThrow("does not match the request");
    expect(() =>
      parseConnectionsImportResponse(
        {
          data: {
            ...response.data,
            connections: [
              { ...response.data.connections[0], unexpected: true },
            ],
          },
        },
        "https://takos.example",
        document,
      ),
    ).toThrow("Invalid Connections import result");
    expect(() =>
      parseConnectionsImportResponse(
        {
          data: {
            ...response.data,
            connections: [
              {
                ...response.data.connections[0],
                tool_policies_require_review: 1,
              },
            ],
          },
        },
        "https://takos.example",
        document,
      ),
    ).toThrow("does not match the request");

    const registryDocument: McpConnectionsDocument = {
      ...document,
      registry_sources: [
        {
          kind: "custom",
          name: "Internal registry",
          base_url: "https://registry.example",
          enabled: true,
          priority: 10,
          auth_type: "none",
          auth_header_name: null,
          credential_required: false,
        },
      ],
    };
    expect(
      parseConnectionsImportResponse(
        {
          data: {
            registry_sources: [
              {
                base_url: "https://registry.example",
                status: "created",
              },
            ],
            connections: response.data.connections,
          },
        },
        "https://takos.example",
        registryDocument,
      ).registry_sources[0]?.base_url,
    ).toBe("https://registry.example");
    expect(() =>
      parseConnectionsImportResponse(
        {
          data: {
            registry_sources: [
              {
                base_url: "https://other-registry.example",
                status: "created",
              },
            ],
            connections: response.data.connections,
          },
        },
        "https://takos.example",
        registryDocument,
      ),
    ).toThrow("does not match the request");
  });

  test("accepts only a complete re-importable Connections export", () => {
    const document = connectionsDocument();
    expect(parseConnectionsExportResponse({ data: document })).toEqual(
      document,
    );
    expect(JSON.parse(serializeConnectionsExportDocument(document))).toEqual(
      document,
    );
    expect(() =>
      parseConnectionsExportResponse({
        data: {
          ...document,
          connections: [
            document.connections[0],
            document.connections[0],
          ],
        },
      })
    ).toThrow("Duplicate MCP Connections identity");
  });

  test("rejects a valid-shape document that exceeds the direct import bytes", () => {
    const tools = Array.from({ length: 2048 }, (_, index) => ({
      name: `tool-${String(index).padStart(4, "0")}-${"x".repeat(240)}`,
      schema_hash: "a".repeat(64),
      enabled: true,
      invocation_policy: "confirm_each_time",
    }));
    const connections = Array.from({ length: 32 }, (_, index) => ({
      name: `connection-${index}`,
      url: `https://connector-${index}.example/${"x".repeat(1900)}`,
      transport: "streamable-http",
      enabled: true,
      scope: "s".repeat(4096),
      tools: index === 0 ? tools : [],
    }));
    expect(() =>
      serializeConnectionsExportDocument({
        ...connectionsDocument(),
        connections,
      })
    ).toThrow("exceeds the import limit");
  });
});
