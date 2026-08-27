import { createWorkerWorkspaceCore } from "../../../adapters/workspaces/index.ts";
import type { SqlDatabaseLike } from "../../../infra/db/index.ts";
import type { Space } from "../../../shared/types/index.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { coreWorkspaceToSpace } from "./space-crud-shared.ts";

export async function loadSpace(
  db: SqlDatabaseLike,
  spaceIdOrSlug: string,
  principalId: string,
): Promise<Space | null> {
  const workspace = await createWorkerWorkspaceCore(db).resolve(
    principalId,
    spaceIdOrSlug,
  );
  return workspace ? coreWorkspaceToSpace(workspace) : null;
}

export interface SpaceAccess {
  space: Space;
}

export async function checkSpaceAccess(
  db: SqlDatabaseLike,
  spaceIdOrSlug: string,
  principalId: string,
): Promise<SpaceAccess | null> {
  if (!isValidOpaqueId(principalId) || !isValidOpaqueId(spaceIdOrSlug)) {
    return null;
  }

  const space = await loadSpace(db, spaceIdOrSlug, principalId);
  return space ? { space } : null;
}
