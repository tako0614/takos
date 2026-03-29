/**
 * MCP Builtin Tools
 *
 * mcp_add_server    - Register an external MCP server (starts OAuth flow if needed)
 * mcp_list_servers  - List registered MCP servers for the current workspace
 * mcp_update_server - Update an existing registered MCP server
 * mcp_remove_server - Remove a registered MCP server
 */
import type { ToolDefinition, ToolHandler } from '../tool-definitions';
export declare const MCP_ADD_SERVER: ToolDefinition;
export declare const mcpAddServerHandler: ToolHandler;
export declare const MCP_LIST_SERVERS: ToolDefinition;
export declare const mcpListServersHandler: ToolHandler;
export declare const MCP_REMOVE_SERVER: ToolDefinition;
export declare const mcpRemoveServerHandler: ToolHandler;
export declare const MCP_UPDATE_SERVER: ToolDefinition;
export declare const mcpUpdateServerHandler: ToolHandler;
export declare const MCP_TOOLS: ToolDefinition[];
export declare const MCP_HANDLERS: Record<string, ToolHandler>;
//# sourceMappingURL=mcp.d.ts.map