import {
  deleteEnv,
  getEnv,
  setEnv,
} from "@takos/worker-platform-utils/runtime-env";
import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { buildDispatcher } from "../dispatch-resolver.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

test("buildDispatcher fails closed without an external runtime target", async () => {
  const previousTargets = getEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  deleteEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  try {
    const dispatcher = await buildDispatcher({ forwardTargets: {} });
    const response = await dispatcher.get("worker-demo").fetch(
      new Request("https://tenant.example.test/"),
    );

    assertEquals(response.status, 503);
    assertEquals(await response.json(), {
      error: "Local service target not configured",
      worker: "worker-demo",
    });
  } finally {
    restoreEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON", previousTargets);
  }
});

test("buildDispatcher registers explicit external runtime targets", async () => {
  const previousTargets = getEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON");
  setEnv(
    "TAKOS_LOCAL_DISPATCH_TARGETS_JSON",
    JSON.stringify({
      "worker-demo": "https://runtime.example.test/base/",
    }),
  );
  try {
    const forwardTargets: Record<string, string> = {};
    await buildDispatcher({ forwardTargets });

    assertEquals(forwardTargets, {
      "worker-demo": "https://runtime.example.test/base/",
    });
  } finally {
    restoreEnv("TAKOS_LOCAL_DISPATCH_TARGETS_JSON", previousTargets);
  }
});
