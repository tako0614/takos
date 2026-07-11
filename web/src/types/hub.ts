/**
 * Client-side type definitions for the Hub view (MCP servers).
 *
 * These mirror the shapes returned by the API, using snake_case field names
 * as they appear in JSON responses.
 */

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
  scope?: string | null;
  issuer_url?: string | null;
  authorization_status: McpAuthorizationStatus;
  service_id?: string | null;
  bundle_deployment_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export type McpAuthorizationStatus =
  | "not_required"
  | "authorized"
  | "authorization_required"
  | "reauthorization_required"
  | "managed";

export interface McpServerTool {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } | null;
  execution: {
    taskSupport?: "forbidden" | "optional" | "required";
  } | null;
  supported: boolean;
  unsupported_reason: "task_execution_required" | null;
  enabled: boolean;
  review_required: boolean;
  schema_hash: string;
  policy_read_only: boolean;
  reviewed_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  risk_level: string;
  side_effects: boolean;
  invocation_policy: "automatic" | "confirm_each_time";
}

export interface McpToolConfirmation {
  id: string;
  server_id: string;
  server_name: string;
  tool_name: string;
  schema_hash: string;
  arguments: Record<string, unknown>;
  requested_run_id: string;
  requested_thread_id: string;
  status: "pending";
  expires_at: string;
  created_at: string;
}

export type McpRegistrySourceKind =
  "official" | "organization" | "community" | "custom";
export type McpDiscoverySourceKind = McpRegistrySourceKind | "server_card";
export type McpRegistryAuthType = "none" | "bearer" | "header";

export interface McpRegistrySource {
  id: string;
  workspace_id: string | null;
  name: string;
  base_url: string;
  source_kind: McpRegistrySourceKind;
  auth_type: McpRegistryAuthType;
  auth_header_name: string | null;
  credential_configured: boolean;
  enabled: boolean;
  priority: number;
  priority_semantics: "higher_first";
  read_only: boolean;
  preview: boolean;
  best_effort: boolean;
  verification_status: string;
  security_status: string;
  created_at: string | null;
  updated_at: string | null;
  safety_assertion: "none";
}

export interface McpRegistryProvenance {
  source_id: string;
  source_name: string;
  source_kind: McpDiscoverySourceKind;
  base_url: string;
  priority: number;
  preview: boolean;
  best_effort: boolean;
  server_name: string;
  server_version: string;
  card_url?: string | null;
}

export interface McpRegistrySearchCandidate {
  name: string;
  title: string | null;
  description: string | null;
  version: string;
  url: string | null;
  transport: "streamable-http" | "package";
  repository_url: string | null;
  repository_subfolder: string | null;
  requires_configuration: boolean;
  packages: McpRegistryPackage[];
  provenance: McpRegistryProvenance[];
}

export interface McpRegistryPackage {
  registry_type: "npm" | "oci";
  registry_base_url: string | null;
  identifier: string;
  version: string | null;
  file_sha256: string | null;
  transport_type: string;
  transport_url: string | null;
  runtime_hint: string | null;
  requires_configuration: boolean;
}

export interface McpRegistrySearchSourceResult {
  source_id: string;
  source_name: string;
  matched_servers: number;
  candidate_count: number;
  skipped_remote_count: number;
}

export interface McpRegistrySearchFailure {
  source_id: string;
  source_name: string;
  source_kind: McpDiscoverySourceKind;
  code: string;
  message: string;
  status: number | null;
}

export interface McpRegistrySearchResult {
  query: string;
  candidates: McpRegistrySearchCandidate[];
  source_results: McpRegistrySearchSourceResult[];
  source_failures: McpRegistrySearchFailure[];
  limitations: {
    mode: string;
    upstream_search: "server_name_substring_only";
    cached_full_text_aggregation: boolean;
    credentials_supported: boolean;
    note: string;
  };
  discovery?: {
    type: "server_card";
    experimental: true;
    catalog_url: string;
  };
}

export interface McpServerCardDiscoveryResult {
  domain: string;
  catalog_url: string;
  experimental: true;
  candidates: McpRegistrySearchCandidate[];
  failures: Array<{
    entry_identifier: string | null;
    message: string;
  }>;
}
