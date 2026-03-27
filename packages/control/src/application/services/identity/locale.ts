import type { D1Database } from '../../../shared/types/bindings.ts';
import { and, eq } from 'drizzle-orm';

import { accountMetadata, getDb } from '../../../infra/db';
import { isSkillLocale } from '../agent/official-skills';
import type { SkillLocale } from '../agent/skill-contracts';

export async function getSpaceLocale(
  dbBinding: D1Database,
  spaceId: string,
): Promise<SkillLocale | null> {
  const db = getDb(dbBinding);
  const row = await db.select({ value: accountMetadata.value })
    .from(accountMetadata)
    .where(and(eq(accountMetadata.accountId, spaceId), eq(accountMetadata.key, 'locale')))
    .get();

  return isSkillLocale(row?.value) ? row.value : null;
}
