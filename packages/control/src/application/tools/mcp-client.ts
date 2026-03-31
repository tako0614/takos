/**
 * MCP Client
 *
 * Lightweight wrapper around @modelcontextprotocol/sdk for connecting to
 * external MCP servers from Cloudflare Workers using fetch-based transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from './tool-definitions.ts';
import { logWarn } from '../../shared/utils/logger.ts';

export type { McpTool };

/** Convert an MCP tool schema to a ToolDefinition for the resolver. */
export function convertMcpSchema(tool: McpTool): ToolDefinition {
  const schema = tool.inputSchema as ToolDefinition['parameters'] | undefined;
  return {
    name: tool.name,
    description: tool.description ?? '',
    category: 'mcp',
    parameters: schema ?? { type: 'object', properties: {} },
  };
}

export class McpClient {
  private client: Client | null = null;

  constructor(
    private readonly serverUrl: string,
    private readonly accessToken: string | null,
    readonly serverName: string,
  ) {}

  /** Connect to the MCP server. Tries StreamableHTTP; falls back to SSE path. */
  async connect(): Promise<void> {
    const authFetch = (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers as HeadersInit | undefined);
      if (this.accessToken) {
        headers.set('Authorization', `Bearer ${this.accessToken}`);
      }
      return fetch(url, { ...init, headers });
    };

    // Try StreamableHTTP first (preferred for Workers — pure fetch-based)
    try {
      const transport = new StreamableHTTPClientTransport(new URL(this.serverUrl), {
        fetch: authFetch as typeof fetch,
      });
      const client = new Client(
        { name: 'takos-mcp-client', version: '1.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
      this.client = client;
      return;
    } catch (streamErr) {
      logWarn(`StreamableHTTP failed, falling back to SSE`, { module: 'mcpclient:${this.servername}', detail: streamErr });
    }

    // Fallback: SSE transport (append /sse to the server URL)
    const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
    const sseUrl = new URL('/sse', this.serverUrl);
    const transport = new SSEClientTransport(sseUrl, {
      requestInit: {
        headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {},
      },
    });
    const client = new Client(
      { name: 'takos-mcp-client', version: '1.0.0' },
      { capabilities: {} },
    );
    await client.connect(transport);
    this.client = client;
  }

  /** List all tools advertised by the connected MCP server. */
  async listTools(): Promise<Array<{ sdkTool: McpTool; definition: ToolDefinition }>> {
    if (!this.client) throw new Error(`McpClient(${this.serverName}) not connected`);
    const { tools } = await this.client.listTools();
    return tools.map((sdkTool: McpTool) => ({ sdkTool, definition: convertMcpSchema(sdkTool) }));
  }

  /** Call a tool on the MCP server and return the result as a string. */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.client) throw new Error(`McpClient(${this.serverName}) not connected`);
    const result = await this.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal },
    );
    const content = Array.isArray((result as { content?: unknown }).content)
      ? (result as { content: Array<{ type?: unknown; text?: unknown }> }).content
      : [];
    if (content.length === 0) return '';
    return content
      .map((item) => (
        item.type === 'text' && typeof item.text === 'string'
          ? item.text
          : JSON.stringify(item)
      ))
      .join('\n');
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
