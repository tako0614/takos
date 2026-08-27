import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import type { SecurityPosture } from "../../../shared/types/index.ts";
import { isValidOpaqueId } from "../../../shared/utils/db-guards.ts";
import { updateSqlWorkspaceModelSettings } from "../../../adapters/workspaces/index.ts";

import { accounts, getDb } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";

interface ModelSettings {
  ai_model: string | null;
  model_backend: string | null;
  security_posture: SecurityPosture;
}

export const spaceModelDeps = {
  getDb,
  isValidOpaqueId,
};

export async function getWorkspaceModelSettings(
  db: SqlDatabaseBinding,
  spaceId: string,
): Promise<ModelSettings | null> {
  if (!spaceModelDeps.isValidOpaqueId(spaceId)) {
    return null;
  }

  const drizzle = spaceModelDeps.getDb(db);
  const row = await drizzle
    .select({
      ai_model: accounts.aiModel,
      model_backend: accounts.modelBackend,
      security_posture: accounts.securityPosture,
    })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();

  return row
    ? {
      ai_model: row.ai_model,
      model_backend: row.model_backend,
      security_posture: row.security_posture === "restricted_egress"
        ? "restricted_egress"
        : "standard",
    }
    : null;
}

export async function updateWorkspaceModel(
  db: SqlDatabaseBinding,
  principalId: string,
  spaceId: string,
  model: string,
  modelBackend: string,
): Promise<boolean> {
  return await updateSqlWorkspaceModelSettings(db, principalId, spaceId, {
    model,
    backend: modelBackend,
    updatedAt: new Date().toISOString(),
  });
}
