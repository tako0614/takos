import { createWorkerWorkspaceCore } from "../../../adapters/workspaces/index.ts";
import type { SqlDatabaseLike } from "../../../infra/db/index.ts";
import type { Env, Space } from "../../../shared/types/index.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import {
  coreWorkspaceToSpace,
  type SpaceListItem,
} from "./space-crud-shared.ts";

export async function listWorkspacesForUser(
  env: Env,
  principalId: string,
): Promise<SpaceListItem[]> {
  if (!isValidOpaqueId(principalId)) return [];
  const rows = await createWorkerWorkspaceCore(env.DB).list(principalId);
  return rows.map(coreWorkspaceToSpace);
}

export async function getWorkspaceByIdOrSlug(
  db: SqlDatabaseLike,
  principalId: string,
  idOrSlug: string,
): Promise<Space | null> {
  if (!isValidOpaqueId(principalId) || !isValidOpaqueId(idOrSlug)) return null;
  const row = await createWorkerWorkspaceCore(db).resolve(
    principalId,
    idOrSlug,
  );
  return row ? coreWorkspaceToSpace(row) : null;
}

export async function loadSpaceById(
  db: SqlDatabaseLike,
  principalId: string,
  spaceId: string,
): Promise<Space | null> {
  return await getWorkspaceByIdOrSlug(db, principalId, spaceId);
}
