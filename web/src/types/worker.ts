// Re-export common type aliases from backend shared models.
// The frontend worker/app/resource types represent enriched API response
// shapes, so they are defined locally and reference backend types where useful.
import type {
  AppType,
  ServiceStatus,
  ServiceType,
} from "takos-api-contract/shared/types";

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
  created_at: string;
  updated_at: string;
  url?: string | null;
  workspace_name?: string | null;
  service_hostname?: string | null;
  service_status?: Worker["status"] | null;
  worker?: Worker;
}

/**
 * Frontend Resource: a simplified view of the backend Resource type with
 * a narrower set of resource types and statuses relevant to the UI.
 */
export interface Resource {
  id: string;
  owner_id: string;
  name: string;
  type:
    | "sql"
    | "object-store"
    | "key-value"
    | "queue"
    | "vector-index"
    | "analytics-engine"
    | "secret"
    | "workflow"
    | "durable-object"
    | "worker";
  status: "creating" | "active" | "error" | "deleting" | "deleted";
  config: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}
