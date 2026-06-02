/**
 * MCP Client
 *
 * Lightweight wrapper around @modelcontextprotocol/sdk for connecting to
 * external MCP servers using fetch-based transports.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import type { ToolDefinition } from "./tool-definitions.ts";
import type { FetchBinding } from "../../shared/types/env.ts";
import { logWarn } from "../../shared/utils/logger.ts";

export type { McpTool };

/** Convert an MCP tool schema to a ToolDefinition for the resolver. */
export function convertMcpSchema(tool: McpTool): ToolDefinition {
  const schema = tool.inputSchema as ToolDefinition["parameters"] | undefined;
  return {
    name: tool.name,
    description: tool.description ?? "",
    category: "mcp",
    parameters: schema ?? { type: "object", properties: {} },
  };
}

/**
 * Subset of the MCP SDK `Client` surface that `McpClient` actually
 * exercises (`listTools` / `callTool` / `close`). Widening the internal
 * field to this shape lets tests inject in-memory fakes via
 * `setClientForTest` without `as unknown as` laundering.
 */
type McpClientHandle = Pick<Client, "listTools" | "callTool" | "close">;

export class McpClient {
  private client: McpClientHandle | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly accessToken: string | null,
    readonly serverName: string,
    /**
     * Egress proxy binding (`env.TAKOS_EGRESS`). When provided, all outbound
     * MCP HTTP traffic is routed through the SSRF-guarding egress worker
     * (private-IP / port / protocol / credential / redirect blocking with DNS
     * resolution) instead of reaching the network directly. When omitted
     * (e.g. local/dev platforms without the binding), outbound requests still
     * force `redirect: "manual"` so an MCP server cannot 3xx-redirect the agent
     * into the internal network.
     */
    private readonly egress?: FetchBinding,
  ) {}

  /**
   * Inject a pre-connected client implementation. Exposed for tests that
   * bypass the network-bound `connect()` flow and want to drive
   * `listTools` / `callTool` / `close` against an in-memory fake.
   * Production callers should use `connect()` instead.
   */
  setClientForTest(client: McpClientHandle | null): void {
    this.client = client;
  }

  /**
   * Outbound fetch for the MCP transports. Adds the bearer Authorization
   * header, routes through the egress SSRF proxy when bound, and never
   * auto-follows redirects (an MCP server returning a 3xx to an internal
   * address must not be followed). When the egress binding is present the
   * request is dispatched to it (the egress worker enforces private-IP / port /
   * protocol / credential / redirect blocking after DNS resolution); when it is
   * absent we still force `redirect: "manual"` on the direct fetch.
   */
  private egressFetch = (
    url: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    if (this.accessToken) {
      headers.set("Authorization", `Bearer ${this.accessToken}`);
    }
    const finalInit: RequestInit = {
      ...init,
      headers,
      redirect: "manual",
    };
    if (this.egress) {
      return this.egress.fetch(url as RequestInfo | URL, finalInit);
    }
    return fetch(url, finalInit);
  };

  /** Connect to the MCP server. Tries StreamableHTTP; falls back to SSE path. */
  async connect(): Promise<void> {
    const authFetch = this.egressFetch;

    // Try StreamableHTTP first (preferred for fetch-based runtimes)
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(this.serverUrl),
        {
          fetch: authFetch as typeof fetch,
        },
      );
      const client = new Client(
        { name: "takos-mcp-client", version: "1.0.0" },
        { capabilities: {} },
      );
      await client.connect(transport);
      this.client = client;
      return;
    } catch (streamErr) {
      logWarn(`StreamableHTTP failed, falling back to SSE`, {
        module: `mcpclient:${this.serverName}`,
        detail: streamErr,
      });
    }

    // Fallback: SSE transport (append /sse to the server URL).
    // Pass the same egress-aware fetch so the SSE path also routes through the
    // SSRF proxy and never auto-follows redirects. The Authorization header is
    // injected by egressFetch, so requestInit no longer needs to carry it.
    const { SSEClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/sse.js"
    );
    const sseUrl = new URL("/sse", this.serverUrl);
    const transport = new SSEClientTransport(sseUrl, {
      fetch: authFetch as typeof fetch,
    });
    const client = new Client(
      { name: "takos-mcp-client", version: "1.0.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
    this.client = client;
  }

  /** List all tools advertised by the connected MCP server. */
  async listTools(): Promise<
    Array<{ sdkTool: McpTool; definition: ToolDefinition }>
  > {
    if (!this.client) {
      throw new Error(`McpClient(${this.serverName}) not connected`);
    }
    const { tools } = await this.client.listTools();
    return tools.map((sdkTool: McpTool) => ({
      sdkTool,
      definition: convertMcpSchema(sdkTool),
    }));
  }

  /** Call a tool on the MCP server and return the result as a string. */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.client) {
      throw new Error(`McpClient(${this.serverName}) not connected`);
    }
    const result = await this.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal },
    );
    const content = Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: Array<{ type?: unknown; text?: unknown }> })
        .content
      : [];
    if (content.length === 0) return "";
    return content
      .map((item) => (
        item.type === "text" && typeof item.text === "string"
          ? item.text
          : JSON.stringify(item)
      ))
      .join("\n");
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
