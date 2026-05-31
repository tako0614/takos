import type { Env } from "../../../shared/types/index.ts";
import {
  D1TransactionManager,
  type D1TransactionMode,
} from "../../../shared/utils/db-transaction.ts";
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

type RuntimeGlobal = typeof globalThis & { WebSocketPair?: unknown };

/**
 * Resolves the {@link D1TransactionMode} for the common-env link writes from a
 * runtime descriptor, NOT from the presence of `.prepare` (which real
 * Cloudflare D1 also exposes).
 *
 * On the Cloudflare Workers runtime `WebSocketPair` is defined and `env.DB` is
 * real D1, where sequential `BEGIN/COMMIT` do not compose. The common-env link
 * mutations are reconcile-backed (rows are written with `syncState: "pending"`
 * and a reconcile job is enqueued), so the correct mitigation is
 * `"d1-compensated"`: run the writes directly with no false atomicity claim and
 * let the reconciler heal partial failures. The local stateful SQLite adapter
 * (Node/Deno, no `WebSocketPair`) keeps real savepoint-based transactions via
 * `"local-sqlite"`. We default to the compensated D1 path when uncertain so the
 * non-composing BEGIN/COMMIT shim is never silently relied upon in production.
 */
export function resolveCommonEnvTransactionMode(
  globalScope: RuntimeGlobal = globalThis as RuntimeGlobal,
): D1TransactionMode {
  const isWorkersRuntime = typeof globalScope.WebSocketPair !== "undefined";
  return isWorkersRuntime ? "d1-compensated" : "local-sqlite";
}

export function createCommonEnvDeps(env: Env): CommonEnvDeps {
  const txManager = new D1TransactionManager(env.DB, {
    mode: resolveCommonEnvTransactionMode(),
  });
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
