export type SecurityPosture = "standard" | "restricted_egress";

export {
  MAX_WORKSPACE_DESCRIPTION_CHARACTERS,
  MAX_WORKSPACE_ID_CHARACTERS,
  MAX_WORKSPACE_NAME_CHARACTERS,
  MAX_WORKSPACE_SLUG_CHARACTERS,
} from "../../../core/workspaces/index.ts";

/** Public Takos Workspace record. */
export interface Space {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  security_posture: SecurityPosture;
  created_at: string;
  updated_at: string;
}
