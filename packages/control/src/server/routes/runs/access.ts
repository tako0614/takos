import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { Run, WorkspaceRole } from '../../../shared/types';
import { checkWorkspaceAccess } from '../../../shared/utils';
import { getDb } from '../../../infra/db';
import { runs } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { asPrismaRunRow, prismaRunToApi } from '../../../application/services/runs/shared';

export type RunAccessResult = {
  run: Run;
  role: WorkspaceRole;
};

export async function checkRunAccess(
  db: SqlDatabaseBinding,
  runId: string,
  userId: string,
  requiredRole?: WorkspaceRole[],
): Promise<RunAccessResult | null> {
  const drizzle = getDb(db);
  const row = await drizzle.select().from(runs).where(eq(runs.id, runId)).get();

  if (!row) {
    return null;
  }

  const run = prismaRunToApi(asPrismaRunRow({ ...row, spaceId: row.accountId }));
  const access = await checkWorkspaceAccess(db, run.space_id, userId, requiredRole);
  if (!access) {
    return null;
  }

  return { run, role: access.member.role };
}
