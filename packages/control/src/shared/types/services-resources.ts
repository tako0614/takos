export type ServiceType = "app" | "service";
export type ServiceStatus =
  | "pending"
  | "building"
  | "deployed"
  | "failed"
  | "stopped";

export interface Service {
  id: string;
  space_id: string;
  group_id?: string | null;
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

export type ResourceCapability =
  | "sql"
  | "object_store"
  | "kv"
  | "queue"
  | "vector_index"
  | "analytics_store"
  | "secret"
  | "workflow_runtime"
  | "durable_namespace";

export type ResourcePublicType =
  | "sql"
  | "object-store"
  | "key-value"
  | "queue"
  | "vector-index"
  | "analytics-engine"
  | "secret"
  | "workflow"
  | "durable-object";

export type ResourceLegacyPublicType =
  | "d1"
  | "r2"
  | "kv"
  | "vectorize"
  | "analyticsEngine"
  | "secretRef"
  | "durableObject";

export type ResourceType =
  | ResourcePublicType
  | ResourceLegacyPublicType
  | "worker"
  | "analyticsEngine"
  | "analytics_engine"
  | "durableObject"
  | "durable_object"
  | "assets";
export type ResourceStatus =
  | "provisioning"
  | "active"
  | "failed"
  | "deleting"
  | "deleted";
export type ResourcePermission = "read" | "write" | "admin";

export interface Resource {
  id: string;
  owner_id: string;
  space_id: string | null;
  group_id?: string | null;
  name: string;
  type: ResourceType;
  capability?: string;
  implementation?: string | null;
  driver?: string | null;
  backend_name?: string | null;
  status: ResourceStatus;
  backing_resource_id?: string | null;
  backing_resource_name?: string | null;
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
  | "d1"
  | "r2"
  | "kv"
  | "vectorize"
  | "queue"
  | "analyticsEngine"
  | "analytics_engine"
  | "secretRef"
  | "workflow"
  | "durableObject"
  | "service";

export type AppType = "platform" | "custom";

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
