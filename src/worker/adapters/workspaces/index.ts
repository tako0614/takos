import {
  createWorkspaceCore,
  type WorkspaceCore,
} from "../../../core/workspaces/index.ts";
import type { SqlDatabaseLike } from "../../infra/db/index.ts";
import { createSqlWorkspacePersistence } from "./sql-workspace-persistence.ts";

export function createWorkerWorkspaceCore(
  database: SqlDatabaseLike,
): WorkspaceCore {
  return createWorkspaceCore({
    persistence: createSqlWorkspacePersistence(database),
    clock: { now: () => new Date().toISOString() },
    ids: { nextWorkspaceId: () => crypto.randomUUID() },
  });
}

export {
  createSqlWorkspacePersistence,
  updateSqlWorkspaceModelSettings,
} from "./sql-workspace-persistence.ts";
