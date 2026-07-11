/**
 * MCP Client
 *
 * Lightweight wrapper around @modelcontextprotocol/sdk for connecting to
 * external MCP servers using fetch-based transports.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import {
  ToolExecutionUncertainError,
  type ToolDefinition,
} from "./tool-definitions.ts";
import type { FetchBinding } from "../../shared/types/env.ts";
import { combineSignals } from "@takos/worker-platform-utils/abort";
import {
  MAX_TOOL_ERROR_SIZE,
  MAX_TOOL_OUTPUT_SIZE,
} from "../../shared/config/limits.ts";

export type { McpTool };

export interface McpEgressContext {
  spaceId: string;
  runId?: string;
  mode: "mcp-catalog" | "mcp-tool" | "mcp-policy-review";
}

/** Convert an MCP tool schema to a ToolDefinition for the resolver. */
export function convertMcpSchema(tool: McpTool): ToolDefinition {
  const schema = tool.inputSchema as ToolDefinition["parameters"] | undefined;
  return {
    name: tool.name,
    description: tool.description ?? "",
    category: "mcp",
    annotations: tool.annotations,
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

const MAX_TOOL_LIST_PAGES = 64;
const MAX_TOOLS_PER_SERVER = 512;
const MAX_MCP_TOOL_SNAPSHOT_BYTES = 128 * 1024;
const MAX_MCP_SERVER_CATALOG_BYTES = 4 * 1024 * 1024;
const MAX_MCP_HTTP_RESPONSE_BYTES = 5 * 1024 * 1024;

function boundMcpHttpResponse(response: Response): Response {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_MCP_HTTP_RESPONSE_BYTES) {
    return new Response("MCP response body exceeds the Takos transport limit", {
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!response.body) return response;
  let received = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > MAX_MCP_HTTP_RESPONSE_BYTES) {
        controller.error(
          new Error("MCP response body exceeds the Takos transport limit"),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return new Response(response.body.pipeThrough(limiter), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function jsonUtf8Bytes(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("MCP tool snapshot is not serializable JSON");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

function boundedUtf8Prefix(value: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let end = maxBytes; end >= Math.max(0, maxBytes - 4); end--) {
    try {
      return decoder.decode(encoded.subarray(0, end));
    } catch {
      // Retry past a partial trailing code point.
    }
  }
  return "";
}

function boundedMcpText(
  value: string,
  maxBytes: number,
  label: string,
): string {
  const encodedBytes = new TextEncoder().encode(value).byteLength;
  if (encodedBytes <= maxBytes) return value;
  const notice = `\n... [${label} TRUNCATED: ${encodedBytes} UTF-8 bytes total]`;
  const noticeBytes = new TextEncoder().encode(notice).byteLength;
  return boundedUtf8Prefix(value, Math.max(0, maxBytes - noticeBytes)) + notice;
}

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
    private readonly egressContext?: McpEgressContext,
    private readonly allowDirectEgress = false,
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
  private egressFetch = async (
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
      // These internal attribution headers are consumed and stripped by the
      // binding-only egress entrypoint. Never attach them to a direct network
      // request, where workspace/run identifiers would leak to the MCP server.
      if (this.egressContext) {
        headers.set("X-Takos-Space-Id", this.egressContext.spaceId);
        headers.set("X-Takos-Egress-Mode", this.egressContext.mode);
        if (this.egressContext.runId) {
          headers.set("X-Takos-Run-Id", this.egressContext.runId);
        }
      }
      return boundMcpHttpResponse(
        await this.egress.fetch(url as RequestInfo | URL, finalInit),
      );
    }
    if (!this.allowDirectEgress) {
      return Promise.reject(
        new Error(
          `McpClient(${this.serverName}) safe egress binding is unavailable`,
        ),
      );
    }
    return boundMcpHttpResponse(await fetch(url, finalInit));
  };

  /** Connect to the MCP server using the current Streamable HTTP transport. */
  async connect(signal?: AbortSignal): Promise<void> {
    const authFetch: typeof fetch = signal
      ? (((url, init) =>
          this.egressFetch(url, {
            ...init,
            signal: init?.signal ? combineSignals(init.signal, signal) : signal,
          })) as typeof fetch)
      : (this.egressFetch as typeof fetch);

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
  }

  /** List all tools advertised by the connected MCP server. */
  async listTools(
    signal?: AbortSignal,
  ): Promise<Array<{ sdkTool: McpTool; definition: ToolDefinition }>> {
    if (!this.client) {
      throw new Error(`McpClient(${this.serverName}) not connected`);
    }
    const tools: McpTool[] = [];
    let catalogBytes = 0;
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_LIST_PAGES; page++) {
      const result = await this.client.listTools(
        cursor ? { cursor } : undefined,
        signal ? { signal } : undefined,
      );
      for (const tool of result.tools) {
        const toolBytes = jsonUtf8Bytes(tool);
        if (toolBytes > MAX_MCP_TOOL_SNAPSHOT_BYTES) {
          throw new Error(
            `McpClient(${this.serverName}) advertised a tool snapshot larger than ${MAX_MCP_TOOL_SNAPSHOT_BYTES} bytes`,
          );
        }
        catalogBytes += toolBytes;
        if (catalogBytes > MAX_MCP_SERVER_CATALOG_BYTES) {
          throw new Error(
            `McpClient(${this.serverName}) tool catalog exceeds ${MAX_MCP_SERVER_CATALOG_BYTES} bytes`,
          );
        }
        tools.push(tool);
      }
      if (tools.length > MAX_TOOLS_PER_SERVER) {
        throw new Error(
          `McpClient(${this.serverName}) advertised more than ${MAX_TOOLS_PER_SERVER} tools`,
        );
      }
      const nextCursor = result.nextCursor?.trim();
      if (!nextCursor) {
        return tools.map((sdkTool: McpTool) => ({
          sdkTool,
          definition: convertMcpSchema(sdkTool),
        }));
      }
      if (seenCursors.has(nextCursor)) {
        throw new Error(
          `McpClient(${this.serverName}) repeated a tools/list cursor`,
        );
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error(
      `McpClient(${this.serverName}) exceeded ${MAX_TOOL_LIST_PAGES} tools/list pages`,
    );
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
    let result: Awaited<ReturnType<McpClientHandle["callTool"]>>;
    try {
      result = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal },
      );
    } catch (error) {
      const detail = boundedMcpText(
        error instanceof Error ? error.message : String(error),
        MAX_TOOL_ERROR_SIZE,
        "MCP ERROR",
      );
      throw new ToolExecutionUncertainError(
        `MCP tool ${toolName} was dispatched, but its outcome is unknown: ${detail}`,
        { cause: error },
      );
    }
    const payload = result as {
      content?: unknown;
      structuredContent?: unknown;
      isError?: unknown;
    };
    const content = Array.isArray(payload.content)
      ? (payload.content as Array<{ type?: unknown; text?: unknown }>)
      : [];
    const parts = content.map((item) =>
      item.type === "text" && typeof item.text === "string"
        ? item.text
        : JSON.stringify(item),
    );
    if (payload.structuredContent !== undefined) {
      parts.push(JSON.stringify(payload.structuredContent));
    }
    const output = parts.join("\n");
    if (payload.isError === true) {
      const detail = boundedMcpText(output, MAX_TOOL_ERROR_SIZE, "MCP ERROR");
      throw new ToolExecutionUncertainError(
        detail.trim()
          ? `MCP tool ${toolName} reported an error after dispatch: ${detail}`
          : `MCP tool ${toolName} reported an error after dispatch; its side-effect outcome is unknown`,
      );
    }
    return boundedMcpText(output, MAX_TOOL_OUTPUT_SIZE, "MCP OUTPUT");
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
