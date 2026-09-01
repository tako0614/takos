/**
 * Public Takos Workspace record. Internal account/team/membership storage is
 * intentionally not reflected here.
 * The canonical `id` is required even when navigation uses the `me` alias or
 * a mutable slug.
 */
export interface Space {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  is_default: boolean;
  security_posture: "standard" | "restricted_egress";
  created_at: string;
  updated_at: string;
}
