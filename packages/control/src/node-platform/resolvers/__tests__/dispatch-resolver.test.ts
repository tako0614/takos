import { assertEquals } from "jsr:@std/assert";

import type { D1Database, R2Bucket } from "../../../shared/types/bindings.ts";
import type { TenantWorkerRuntimeRegistry } from "../../../local-platform/tenant-worker-runtime.ts";
import { buildDispatcher } from "../dispatch-resolver.ts";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
}

Deno.test("buildDispatcher creates tenant runtime registry for backend-specific Node env without dataDir", async () => {
  const previousNamespace = Deno.env.get("WFP_DISPATCH_NAMESPACE");
  const previousAccountId = Deno.env.get("CF_ACCOUNT_ID");
  const previousApiToken = Deno.env.get("CF_API_TOKEN");
  const previousTargets = Deno.env.get("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  Deno.env.delete("WFP_DISPATCH_NAMESPACE");
  Deno.env.delete("CF_ACCOUNT_ID");
  Deno.env.delete("CF_API_TOKEN");
  Deno.env.delete("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  try {
    const registries = new Set<TenantWorkerRuntimeRegistry>();
    const dispatcher = await buildDispatcher({
      dataDir: null,
      db: {} as D1Database,
      workerBundles: {} as R2Bucket,
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

Deno.test("buildDispatcher leaves tenant runtime to Workers Dispatch when WFP is configured", async () => {
  const previousNamespace = Deno.env.get("WFP_DISPATCH_NAMESPACE");
  const previousAccountId = Deno.env.get("CF_ACCOUNT_ID");
  const previousApiToken = Deno.env.get("CF_API_TOKEN");
  Deno.env.set("CF_ACCOUNT_ID", "account");
  Deno.env.set("CF_API_TOKEN", "token");
  Deno.env.set("WFP_DISPATCH_NAMESPACE", "takos-tenants");
  try {
    const registries = new Set<TenantWorkerRuntimeRegistry>();
    const dispatcher = await buildDispatcher({
      dataDir: null,
      db: {} as D1Database,
      workerBundles: {} as R2Bucket,
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
