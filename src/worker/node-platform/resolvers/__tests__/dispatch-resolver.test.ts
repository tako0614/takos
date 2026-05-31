import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { test } from "bun:test";
import { assertEquals } from "@std/assert";

import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
} from "../../../shared/types/bindings.ts";
import type { TenantWorkerRuntimeRegistry } from "../../../local-platform/tenant-worker-runtime.ts";
import { buildDispatcher } from "../dispatch-resolver.ts";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

test("buildDispatcher creates tenant runtime registry for backend-specific Node env without dataDir", async () => {
  const previousNamespace = getEnv("WFP_DISPATCH_NAMESPACE");
  const previousAccountId = getEnv("CF_ACCOUNT_ID");
  const previousApiToken = getEnv("CF_API_TOKEN");
  const previousTargets = getEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  deleteEnv("WFP_DISPATCH_NAMESPACE");
  deleteEnv("CF_ACCOUNT_ID");
  deleteEnv("CF_API_TOKEN");
  deleteEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  try {
    const registries = new Set<TenantWorkerRuntimeRegistry>();
    const dispatcher = await buildDispatcher({
      dataDir: null,
      db: {} as SqlDatabaseBinding,
      workerBundles: {} as ObjectStoreBinding,
      encryptionKey: "test-key",
      pgPool: undefined,
      forwardTargets: {},
      dispatchRegistries: registries,
    });

    const fetcher = dispatcher?.get("worker-demo", {
      deploymentId: "deployment-demo-v1",
    });
    assertEquals(typeof fetcher?.fetch, "function");
    assertEquals(registries.size, 1);
  } finally {
    restoreEnv("WFP_DISPATCH_NAMESPACE", previousNamespace);
    restoreEnv("CF_ACCOUNT_ID", previousAccountId);
    restoreEnv("CF_API_TOKEN", previousApiToken);
    restoreEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON", previousTargets);
  }
});

test("buildDispatcher leaves tenant runtime to Workers Dispatch when WFP is configured", async () => {
  const previousNamespace = getEnv("WFP_DISPATCH_NAMESPACE");
  const previousAccountId = getEnv("CF_ACCOUNT_ID");
  const previousApiToken = getEnv("CF_API_TOKEN");
  setEnv("CF_ACCOUNT_ID", "account");
  setEnv("CF_API_TOKEN", "token");
  setEnv("WFP_DISPATCH_NAMESPACE", "takos-tenants");
  try {
    const registries = new Set<TenantWorkerRuntimeRegistry>();
    const dispatcher = await buildDispatcher({
      dataDir: null,
      db: {} as SqlDatabaseBinding,
      workerBundles: {} as ObjectStoreBinding,
      encryptionKey: "test-key",
      pgPool: undefined,
      forwardTargets: {},
      dispatchRegistries: registries,
    });

    const fetcher = dispatcher?.get("worker-demo", {
      deploymentId: "deployment-demo-v1",
    });
    assertEquals(typeof fetcher?.fetch, "function");
    assertEquals(registries.size, 0);
  } finally {
    restoreEnv("WFP_DISPATCH_NAMESPACE", previousNamespace);
    restoreEnv("CF_ACCOUNT_ID", previousAccountId);
    restoreEnv("CF_API_TOKEN", previousApiToken);
  }
});
