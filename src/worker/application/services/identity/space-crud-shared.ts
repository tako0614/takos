import type { Workspace } from "../../../../core/workspaces/index.ts";
import type { Space } from "../../../shared/types/index.ts";

export type SpaceListItem = Space;

/** Map the neutral core record at the explicit legacy Worker adapter seam. */
export function coreWorkspaceToSpace(
  workspace: Workspace,
): Space {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    is_default: workspace.isDefault,
    security_posture: workspace.securityPosture,
    created_at: workspace.createdAt,
    updated_at: workspace.updatedAt,
  };
}
