export interface Takopack {
  id: string;
  name: string;
  version: string;
  versionMajor?: number;
  versionMinor?: number;
  versionPatch?: number;
  description?: string;
  icon?: string;
  installedAt: string;
  sourceType?: 'git' | string | null;
  sourceRepoId?: string | null;
  sourceTag?: string | null;
  sourceAssetId?: string | null;
}

export interface TakopackDetail extends Takopack {
  manifestJson: string;
  groups: ShortcutGroup[];
  uiExtensions: UIExtensionInfo[];
  mcpServers: Array<{
    id: string;
    name: string;
    transport: string;
    enabled: boolean;
  }>;
}

export interface TakopackInstallation {
  id: string;
  spaceId?: string;
  bundleDeploymentId: string;
  name: string;
  version: string;
  action: 'deploy' | 'rollback' | string;
  installedAt: string;
  installedBy: string;
  sourceType?: string | null;
  sourceRepoId?: string | null;
  sourceTag?: string | null;
  sourceAssetId?: string | null;
  replacedBundleDeploymentId?: string | null;
}

export interface ShortcutGroup {
  id: string;
  spaceId: string;
  name: string;
  icon?: string;
  items: ShortcutItem[];
  takopackId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShortcutItem {
  type: 'service' | 'ui' | 'd1' | 'r2' | 'kv' | 'link';
  id: string;
  label: string;
  icon?: string;
  serviceId?: string;
  uiPath?: string;
  resourceId?: string;
  url?: string;
}

export interface UIExtensionInfo {
  id: string;
  path: string;
  label: string;
  icon?: string;
}

export interface CustomTool {
  id: string;
  name: string;
  description: string;
  inputSchema: object;
  type: 'worker' | 'mcp-request';
  workerId?: string;
  enabled: boolean;
  takopackId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomToolInfo {
  id: string;
  name: string;
  description: string;
  type: 'worker' | 'mcp-request';
  enabled: boolean;
}

export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  transport: string;
  enabled: boolean;
  source_type: 'external' | 'service' | 'bundle_deployment';
  auth_mode: 'oauth_pkce' | 'takos_oidc';
  service_id?: string | null;
  bundle_deployment_id?: string | null;
  managed: boolean;
  scope?: string | null;
  issuer_url?: string | null;
  token_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}
