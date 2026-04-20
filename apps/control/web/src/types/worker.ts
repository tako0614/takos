// Re-export common type aliases from backend shared models.
// The frontend worker/app/resource types represent enriched API response
// shapes, so they are defined locally and reference backend types where useful.
import type {
  AppType,
  ServiceStatus,
  ServiceType,
} from "takos-control/shared/types";

/**
 * Frontend Worker (maps to backend Service): includes enriched fields
 * (`workspace_name`, `apps`) that are joined at the API layer.
 */
export interface Worker {
  id: string;
  space_id: string;
  service_type: ServiceType;
  status: ServiceStatus;
  config: string | null;
  hostname: string | null;
  service_name: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
  workspace_name?: string;
  apps?: App[];
}

/**
 * Frontend App: uses `service_id` (vs backend `worker_id`) and adds
 * enriched UI fields from joined service data.
 */
export interface App {
  id: string;
  space_id: string;
  service_id: string | null;
  name: string;
  description: string | null;
  icon: string | null;
  app_type: AppType;
  takos_client_key: string | null;
  created_at: string;
  updated_at: string;
  url?: string | null;
  workspace_name?: string | null;
  service_hostname?: string | null;
  service_status?: Worker["status"] | null;
  worker?: Worker;
}

export interface CustomDomain {
  id: string;
  service_id: string;
  domain: string;
  status:
    | "pending"
    | "verifying"
    | "dns_verified"
    | "ssl_pending"
    | "ssl_failed"
    | "active"
    | "failed"
    | "expired";
  verification_token: string;
  verification_host?: string;
  verification_method: "cname" | "txt";
  cf_custom_hostname_id?: string | null;
  ssl_status: "pending" | "active" | "failed" | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Frontend Resource: a simplified view of the backend Resource type with
 * a narrower set of resource types and statuses relevant to the UI.
 */
export interface Resource {
  id: string;
  owner_id: string;
  name: string;
  type: "d1" | "r2" | "kv" | "vectorize" | "worker";
  status: "creating" | "active" | "error" | "deleting" | "deleted";
  config: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}
