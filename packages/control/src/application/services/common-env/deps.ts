import type { Env } from "../../../shared/types/index.ts";
import { D1TransactionManager } from "../../../shared/utils/db-transaction.ts";
import { CommonEnvReconcileJobStore } from "./reconcile-jobs.ts";
import { CommonEnvReconciler } from "./reconciler.ts";
import { CommonEnvOrchestrator } from "./orchestrator.ts";
import type { SpaceEnvDeps } from "./space-env-ops.ts";
import type { ServiceLinkDeps } from "./service-link-ops.ts";
import type { ManualLinkDeps } from "./manual-link-ops.ts";

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
