// Re-export types from backend shared models to avoid duplication.
import type {
  Space as BackendSpace,
  SpaceKind,
} from "takos-control/shared/types";

/**
 * Frontend Space: picks the fields needed by the UI and adds `is_personal`.
 * `id` is optional because it may be absent in create-flow payloads.
 */
export interface Space extends
  Pick<
    BackendSpace,
    | "slug"
    | "name"
    | "description"
    | "owner_principal_id"
    | "automation_principal_id"
    | "security_posture"
    | "created_at"
    | "updated_at"
  > {
  id?: string;
  kind: SpaceKind;
  is_personal?: boolean;
}
