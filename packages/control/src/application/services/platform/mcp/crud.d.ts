/**
 * MCP Service - CRUD & Managed Server Operations
 *
 * Server listing, creation, update, deletion, external server registration,
 * and managed server reconciliation.
 */
import type { D1Database } from '../../../../shared/types/bindings.ts';
import type { SelectOf } from '../../../../shared/types/drizzle-utils';
import { mcpServers } from '../../../../infra/db';
import type { Env } from '../../../../shared/types';
import type { McpServerRecord, McpIssuerEnv, RegisterExternalMcpServerResult } from './mcp-models';
export declare function upsertManagedMcpServer(dbBinding: D1Database, env: McpIssuerEnv & {
    ENCRYPTION_KEY?: string;
}, params: {
    spaceId: string;
    name: string;
    url: string;
    sourceType: 'worker' | 'bundle_deployment';
    serviceId?: string | null;
    workerId?: string | null;
    bundleDeploymentId?: string | null;
    /** Pre-shared Bearer token for authMode='bearer_token'. */
    authToken?: string;
}): Promise<McpServerRecord>;
export declare function reconcileManagedWorkerMcpServer(dbBinding: D1Database, env: McpIssuerEnv, params: {
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    name?: string | null;
    url?: string | null;
    enabled: boolean;
}): Promise<void>;
export declare function deleteManagedMcpServersByBundleDeployment(dbBinding: D1Database, spaceId: string, bundleDeploymentId: string): Promise<void>;
export declare function registerExternalMcpServer(dbBinding: D1Database, env: Env, params: {
    spaceId: string;
    name: string;
    url: string;
    scope?: string;
}): Promise<RegisterExternalMcpServerResult>;
export declare function getMcpServerWithTokens(dbBinding: D1Database, spaceId: string, serverId: string): Promise<SelectOf<typeof mcpServers> | null>;
export declare function listMcpServers(dbBinding: D1Database, spaceId: string): Promise<McpServerRecord[]>;
export declare function deleteMcpServer(dbBinding: D1Database, spaceId: string, serverId: string): Promise<boolean>;
export declare function updateMcpServer(dbBinding: D1Database, spaceId: string, serverId: string, patch: {
    enabled?: boolean;
    name?: string;
}): Promise<McpServerRecord | null>;
//# sourceMappingURL=crud.d.ts.map