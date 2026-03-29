import type { RegisteredTool } from './tool-definitions';
import type { Env, SpaceRole } from '../../shared/types';
import { McpClient } from './mcp-client';
import type { D1Database } from '../../shared/types/bindings.ts';
export interface McpLoadResult {
    tools: Map<string, RegisteredTool>;
    clients: Map<string, McpClient>;
    failedServers: string[];
}
/** Load MCP server tools, handling token refresh and namespace collisions. */
export declare function loadMcpTools(db: D1Database, spaceId: string, env: Env, existingNames: Set<string>, exposureContext?: {
    role?: SpaceRole;
    capabilities?: string[];
}): Promise<McpLoadResult>;
//# sourceMappingURL=mcp-tools.d.ts.map