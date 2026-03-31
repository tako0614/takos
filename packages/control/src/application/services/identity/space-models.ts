import type { D1Database } from '../../../shared/types/bindings.ts';
import { isValidOpaqueId } from '../../../shared/utils/db-guards.ts';

import { getDb, accounts } from '../../../infra/db/index.ts';
import { eq } from 'drizzle-orm';

interface ModelSettings {
  ai_model: string | null;
  ai_provider: string | null;
}

export async function getWorkspaceModelSettings(
  db: D1Database,
  spaceId: string
): Promise<ModelSettings | null> {
  if (!isValidOpaqueId(spaceId)) {
    return null;
  }

  const drizzle = getDb(db);
  const row = await drizzle
    .select({
      ai_model: accounts.aiModel,
      ai_provider: accounts.aiProvider,
      security_posture: accounts.securityPosture,
    })
    .from(accounts)
    .where(eq(accounts.id, spaceId))
    .limit(1)
    .get();

  return row || null;
}

export async function updateWorkspaceModel(
  db: D1Database,
  spaceId: string,
  model: string,
  provider: string
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle
    .update(accounts)
    .set({
      aiModel: model,
      aiProvider: provider,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(accounts.id, spaceId));
}
