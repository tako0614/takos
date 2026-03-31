import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { Run, SpaceRole } from '../../../shared/types/index.ts';
import { checkSpaceAccess } from '../../../application/services/identity/space-access.ts';
import { getDb } from '../../../infra/db/index.ts';
import { runs } from '../../../infra/db/schema.ts';
import { eq } from 'drizzle-orm';
import { asRunRow, runRowToApi } from '../../../application/services/runs/run-serialization.ts';

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

  const run = runRowToApi(asRunRow({ ...row, spaceId: row.accountId }));
  const access = await checkSpaceAccess(db, run.space_id, userId, requiredRole);
  if (!access) {
    return null;
  }

  return { run, role: access.membership.role };
}
