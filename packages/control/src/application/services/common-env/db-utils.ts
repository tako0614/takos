import type { D1TransactionManager } from '../../../shared/utils/db-transaction';
import type { DbEnv } from '../../../shared/types/env';

export interface DbDeps {
  env: DbEnv;
  txManager: D1TransactionManager;
}

export function runInTransaction<T>(deps: DbDeps, fn: () => Promise<T>): Promise<T> {
  return deps.txManager.runInTransaction(fn);
}
