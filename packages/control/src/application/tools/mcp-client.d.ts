/**
 * MCP Client
 *
 * Lightweight wrapper around @modelcontextprotocol/sdk for connecting to
 * external MCP servers from Cloudflare Workers using fetch-based transports.
 */
import type { Tool as McpTool } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from './tool-definitions';
export type { McpTool };
/** Convert an MCP tool schema to a ToolDefinition for the resolver. */
export declare function convertMcpSchema(tool: McpTool): ToolDefinition;
export declare class McpClient {
    private readonly serverUrl;
    private readonly accessToken;
    readonly serverName: string;
    private client;
    constructor(serverUrl: string, accessToken: string | null, serverName: string);
    /** Connect to the MCP server. Tries StreamableHTTP; falls back to SSE path. */
    connect(): Promise<void>;
    /** List all tools advertised by the connected MCP server. */
    listTools(): Promise<Array<{
        sdkTool: McpTool;
        definition: ToolDefinition;
    }>>;
    /** Call a tool on the MCP server and return the result as a string. */
    callTool(toolName: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
    close(): Promise<void>;
}
//# sourceMappingURL=mcp-client.d.ts.map