import type { Env } from '../../../shared/types';
import { D1TransactionManager } from '../../../shared/utils/db-transaction';
import {
  CommonEnvReconcileJobStore,
} from './reconcile-jobs';
import { CommonEnvReconciler } from './reconciler';
import { CommonEnvOrchestrator } from './orchestrator';
import type { SpaceEnvDeps } from './space-env-ops';
import type { ServiceLinkDeps } from './service-link-ops';
import type { ManualLinkDeps } from './manual-link-ops';

export interface CommonEnvDeps {
  spaceEnv: SpaceEnvDeps;
  serviceLink: ServiceLinkDeps;
  manualLink: ManualLinkDeps;
  orchestrator: CommonEnvOrchestrator;
  reconciler: CommonEnvReconciler;
}

export function createCommonEnvDeps(env: Env): CommonEnvDeps {
  const txManager = new D1TransactionManager(env.DB);
  const jobs = new CommonEnvReconcileJobStore(env);
  const reconciler = new CommonEnvReconciler(env);
  const orchestrator = new CommonEnvOrchestrator(env, jobs, reconciler);

  return {
    spaceEnv: { env, txManager },
    serviceLink: { env, txManager },
    manualLink: { env, txManager, orchestrator },
    orchestrator,
    reconciler,
  };
}
