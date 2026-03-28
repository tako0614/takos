export type ServiceType = 'app' | 'service';
export type ServiceStatus = 'pending' | 'building' | 'deployed' | 'failed' | 'stopped';

export interface Service {
  id: string;
  space_id: string;
  service_type: ServiceType;
  name_type: string | null;
  status: ServiceStatus;
  config: string | null;
  hostname: string | null;
  service_name: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceBinding {
  id: string;
  service_id: string;
  resource_id: string;
  binding_name: string;
  binding_type: BindingType;
  config: string;
  created_at: string;
}

export type ResourceType =
  | 'd1'
  | 'r2'
  | 'worker'
  | 'kv'
  | 'vectorize'
  | 'queue'
  | 'analyticsEngine'
  | 'analytics_engine'
  | 'workflow'
  | 'durable_object'
  | 'assets';
export type ResourceStatus = 'provisioning' | 'active' | 'failed' | 'deleting' | 'deleted';
export type ResourcePermission = 'read' | 'write' | 'admin';

export interface Resource {
  id: string;
  owner_id: string;
  space_id: string | null;
  name: string;
  type: ResourceType;
  status: ResourceStatus;
  cf_id: string | null;
  cf_name: string | null;
  config: string;
  metadata: string;
  size_bytes?: number;
  item_count?: number;
  last_used_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceAccess {
  id: string;
  resource_id: string;
  space_id: string;
  permission: ResourcePermission;
  granted_by: string | null;
  created_at: string;
}

export type BindingType =
  | 'd1'
  | 'r2'
  | 'kv'
  | 'vectorize'
  | 'queue'
  | 'analyticsEngine'
  | 'analytics_engine'
  | 'workflow'
  | 'service';

export type AppType = 'platform' | 'builtin' | 'custom';

export interface App {
  id: string;
  space_id: string;
  worker_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  app_type: AppType;
  takos_client_key: string | null;
  created_at: string;
  updated_at: string;
}
