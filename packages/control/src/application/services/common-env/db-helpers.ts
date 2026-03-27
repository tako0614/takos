import { getDb } from '../../../infra/db/index.js';
import type { D1TransactionManager } from '../../../shared/utils/db-transaction';
import type { DbEnv } from '../../../shared/types/env';

export interface DbDeps {
  env: DbEnv;
  txManager: D1TransactionManager;
}

export function db(deps: DbDeps) {
  return getDb(deps.env.DB);
}

export function runInTransaction<T>(deps: DbDeps, fn: () => Promise<T>): Promise<T> {
  return deps.txManager.runInTransaction(fn);
}
