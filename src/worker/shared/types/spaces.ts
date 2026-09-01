export type SpaceKind = "user" | "team" | "system";
export type SecurityPosture = "standard" | "restricted_egress";

export const MAX_SPACE_ID_CHARACTERS = 128;
export const MAX_SPACE_SLUG_CHARACTERS = 32;
export const MAX_SPACE_NAME_CHARACTERS = 120;
export const MAX_SPACE_DESCRIPTION_CHARACTERS = 2_000;
export const MAX_SPACE_PRINCIPAL_ID_CHARACTERS = 128;
export const MAX_SPACE_TIMESTAMP_CHARACTERS = 64;
export const MAX_SPACES_PER_RESPONSE = 10_000;

export interface Space {
  id: string;
  kind: SpaceKind;
  name: string;
  slug: string | null;
  description?: string | null;
  principal_id?: string;
  owner_user_id?: string;
  owner_principal_id: string;
  automation_principal_id?: string | null;
  head_snapshot_id?: string | null;
  ai_model?: string | null;
  model_backend?: string | null;
  security_posture?: SecurityPosture;
  created_at: string;
  updated_at: string;
}
