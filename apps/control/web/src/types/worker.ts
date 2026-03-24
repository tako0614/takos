export interface Worker {
  id: string;
  space_id: string;
  service_type: 'app' | 'service';
  status: 'pending' | 'building' | 'deployed' | 'failed' | 'stopped';
  config: string | null;
  hostname: string | null;
  service_name: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
  workspace_name?: string;
  apps?: App[];
}

export interface App {
  id: string;
  space_id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  app_type: 'platform' | 'builtin' | 'custom';
  takos_client_key: string | null;
  created_at: string;
  updated_at: string;
  url?: string | null;
  workspace_name?: string | null;
  service_hostname?: string | null;
  service_status?: Worker['status'] | null;
  worker?: Worker;
}

/** @deprecated Use Worker instead */
export interface Deployment {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  deploy_type: 'app' | 'service';
  status: 'pending' | 'building' | 'deployed' | 'failed' | 'stopped';
  url: string | null;
  icon: string | null;
  hostname?: string | null;
  service_name?: string | null;
  slug?: string | null;
  workspace_name?: string;
  created_at: string;
  updated_at: string;
  app_config?: string | null;
  takos_client_entry?: string | null;
  has_takos_client?: boolean;
  has_worker_assets?: boolean;
}

export interface CustomDomain {
  id: string;
  service_id: string;
  domain: string;
  status: 'pending' | 'verifying' | 'dns_verified' | 'ssl_pending' | 'ssl_failed' | 'active' | 'failed' | 'expired';
  verification_token: string;
  verification_host?: string;
  verification_method: 'cname' | 'txt';
  cf_custom_hostname_id?: string | null;
  ssl_status: 'pending' | 'active' | 'failed' | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  owner_id: string;
  name: string;
  type: 'd1' | 'r2' | 'kv' | 'vectorize' | 'worker';
  status: 'creating' | 'active' | 'error' | 'deleting' | 'deleted';
  cf_id: string | null;
  cf_name: string | null;
  config: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}
