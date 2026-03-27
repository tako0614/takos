import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { Run, SpaceRole } from '../../../shared/types';
import { checkSpaceAccess } from '../../../shared/utils';
import { getDb } from '../../../infra/db';
import { runs } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { asPrismaRunRow, prismaRunToApi } from '../../../application/services/runs/shared';

export type RunAccessResult = {
  run: Run;
  role: SpaceRole;
};

export async function checkRunAccess(
  db: SqlDatabaseBinding,
  runId: string,
  userId: string,
  requiredRole?: SpaceRole[],
): Promise<RunAccessResult | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(runs).where(eq(runs.id, runId)).get();

  if (!row) {
    return null;
  }

  const run = prismaRunToApi(asPrismaRunRow({ ...row, spaceId: row.accountId }));
  const access = await checkSpaceAccess(db, run.space_id, userId, requiredRole);
  if (!access) {
    return null;
  }

  return { run, role: access.membership.role };
}
