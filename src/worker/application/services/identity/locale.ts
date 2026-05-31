import { and, eq } from "drizzle-orm";

import {
  accountMetadata,
  getDb,
  type SqlDatabaseLike,
} from "../../../infra/db/index.ts";
import { isSkillLocale } from "../agent/managed-skills.ts";
import type { SkillLocale } from "../agent/skill-contracts.ts";

export const localeDeps = {
  getDb,
  isSkillLocale,
};

export async function getSpaceLocale(
  dbBinding: SqlDatabaseLike,
  spaceId: string,
): Promise<SkillLocale | null> {
  const db = localeDeps.getDb(dbBinding);
  const row = await db.select({ value: accountMetadata.value })
    .from(accountMetadata)
    .where(
      and(
        eq(accountMetadata.accountId, spaceId),
        eq(accountMetadata.key, "locale"),
      ),
    )
    .get();

  return localeDeps.isSkillLocale(row?.value) ? row.value : null;
}
