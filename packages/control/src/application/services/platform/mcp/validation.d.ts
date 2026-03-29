/**
 * MCP Service - URL Validation
 *
 * Endpoint URL validation and security checks for MCP server URLs.
 */
import type { Env } from '../../../../shared/types';
import type { McpEndpointUrlOptions } from './mcp-models';
export declare function getMcpEndpointUrlOptions(env: Pick<Env, 'ENVIRONMENT'>): McpEndpointUrlOptions;
export declare function assertAllowedMcpEndpointUrl(rawUrl: string, options: McpEndpointUrlOptions, label: string): URL;
//# sourceMappingURL=validation.d.ts.map