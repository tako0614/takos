import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { buildDispatcher } from "../dispatch-resolver.ts";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

test("buildDispatcher accepts backend inputs while preserving the external runtime boundary", async () => {
  const previousNamespace = getEnv("WFP_DISPATCH_NAMESPACE");
  const previousAccountId = getEnv("CF_ACCOUNT_ID");
  const previousApiToken = getEnv("CF_API_TOKEN");
  const previousTargets = getEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  deleteEnv("WFP_DISPATCH_NAMESPACE");
  deleteEnv("CF_ACCOUNT_ID");
  deleteEnv("CF_API_TOKEN");
  deleteEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  try {
    const dispatcher = await buildDispatcher({
      forwardTargets: {},
    });

    const fetcher = dispatcher?.get("worker-demo", {
      deploymentId: "deployment-demo-v1",
    });
    assertEquals(typeof fetcher?.fetch, "function");
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
    const dispatcher = await buildDispatcher({
      forwardTargets: {},
    });

    const fetcher = dispatcher?.get("worker-demo", {
      deploymentId: "deployment-demo-v1",
    });
    assertEquals(typeof fetcher?.fetch, "function");
  } finally {
    restoreEnv("WFP_DISPATCH_NAMESPACE", previousNamespace);
    restoreEnv("CF_ACCOUNT_ID", previousAccountId);
    restoreEnv("CF_API_TOKEN", previousApiToken);
  }
});
