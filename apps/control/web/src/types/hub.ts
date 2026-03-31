/**
 * Client-side type definitions for the Hub view (custom tools & MCP servers).
 *
 * These mirror the shapes returned by the API, using snake_case field names
 * as they appear in JSON responses.
 */

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  inputSchema: object;
  enabled: boolean;
  type?: string;
  workerId?: string;
  takopackId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  transport?: string;
  source_type: string;
  auth_mode: string;
  enabled: boolean;
  managed?: boolean;
  token_expires_at?: string | null;
  oauth_scope?: string | null;
  oauth_issuer_url?: string | null;
  service_id?: string | null;
  bundle_deployment_id?: string | null;
  created_at?: string;
  updated_at?: string;
}
