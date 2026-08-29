/**
 * Test-only dispatch composition.
 *
 * Production Node dispatch always delegates tenant workloads to the external
 * runtime boundary. These helpers compose a Miniflare tenant registry only for
 * hermetic bootstrap tests and are intentionally not re-exported by the live
 * local-platform runtime entrypoint.
 */
import { getEnv } from "@takos/worker-platform-utils/runtime-env";
import { loadLocalDispatchEnv, loadLocalWebEnv } from "./load-adapter.ts";
import {
  parseServiceTargetMap,
  type ServiceTargetMap,
} from "./url-registry.ts";
import {
  createLocalTenantWorkerRuntimeRegistry,
  type TenantWorkerRuntimeRegistry,
} from "./tenant-worker-runtime.ts";
import {
  buildDispatcher,
  collectImplicitForwardTargets,
} from "../node-platform/resolvers/dispatch-resolver.ts";
import type { LocalFetch } from "./runtime-types.ts";
import { createLocalExecutionContext } from "./execution-context.ts";
import { buildNodeDispatchPlatform } from "../platform/adapters/node.ts";

const LOCAL_FORWARD_SERVICE_NAMES = new Set([
  "RUNTIME_HOST",
  "runtime-host",
  "EXECUTOR_HOST",
  "executor-host",
  "TAKOS_EGRESS",
  "takos-egress",
]);

function validateLocalForwardTargets(
  targets: ServiceTargetMap,
): ServiceTargetMap {
  const invalidTargets = Object.keys(targets).filter(
    (name) => !LOCAL_FORWARD_SERVICE_NAMES.has(name),
  );
  if (invalidTargets.length > 0) {
    throw new Error(
      `TAKOS_LOCAL_DISPATCH_TARGETS_JSON may only override infra service targets: ${invalidTargets.join(
        ", ",
      )}`,
    );
  }
  return targets;
}

function createLocalTestServiceRegistry(
  forwardTargets: ServiceTargetMap,
  externalDispatcher: NonNullable<Awaited<ReturnType<typeof buildDispatcher>>>,
  tenantRuntime: TenantWorkerRuntimeRegistry,
) {
  return {
    get(name: string, options?: { deploymentId?: string }) {
      if (forwardTargets[name]) return externalDispatcher.get(name, options);
      return tenantRuntime.get(name, options);
    },
  };
}

const testRuntimeDisposers = new Set<() => Promise<void>>();

export async function disposeLocalTestDispatchRuntimes(): Promise<void> {
  const disposers = Array.from(testRuntimeDisposers);
  testRuntimeDisposers.clear();
  await Promise.all(
    disposers.map((dispose) => dispose().catch(() => undefined)),
  );
}

async function composeLocalTestDispatchEnv() {
  const dispatchEnv = await loadLocalDispatchEnv();
  const webEnv = await loadLocalWebEnv();
  const explicitTargets = validateLocalForwardTargets(
    parseServiceTargetMap(getEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON")),
  );
  const forwardTargets = {
    ...collectImplicitForwardTargets(),
    ...explicitTargets,
  };
  const externalDispatcher = await buildDispatcher({
    forwardTargets,
  });
  const tenantRuntime = await createLocalTenantWorkerRuntimeRegistry({
    dataDir: getEnv("TAKOS_LOCAL_DATA_DIR") ?? null,
    db: webEnv.DB,
    workerBundles: webEnv.WORKER_BUNDLES,
    encryptionKey: webEnv.ENCRYPTION_KEY,
    serviceTargets: forwardTargets,
    openAiApiKey: webEnv.OPENAI_API_KEY,
    openAiBaseUrl: webEnv.OPENAI_BASE_URL,
  });

  dispatchEnv.DISPATCHER = createLocalTestServiceRegistry(
    forwardTargets,
    externalDispatcher,
    tenantRuntime,
  );
  testRuntimeDisposers.add(() => tenantRuntime.dispose());
  return dispatchEnv;
}

export async function createLocalDispatchFetchForTests(): Promise<LocalFetch> {
  const env = await composeLocalTestDispatchEnv();
  const { createDispatchWorker } = await import("../dispatch.ts");
  const dispatchWorker = createDispatchWorker(buildNodeDispatchPlatform);
  return (request, executionContext = createLocalExecutionContext()) =>
    dispatchWorker.fetch(request, env, executionContext);
}
