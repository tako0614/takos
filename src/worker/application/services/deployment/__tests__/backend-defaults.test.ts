import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import type { DeploymentEnv } from "../models.ts";
import { resolveDefaultDeploymentBackendName } from "../backend-defaults.ts";

function env(overrides: Partial<DeploymentEnv>): DeploymentEnv {
  return {
    DB: {} as DeploymentEnv["DB"],
    ADMIN_DOMAIN: "admin.example.com",
    TENANT_BASE_DOMAIN: "tenant.example.com",
    HOSTNAME_ROUTING: {} as DeploymentEnv["HOSTNAME_ROUTING"],
    RUN_NOTIFIER: {} as DeploymentEnv["RUN_NOTIFIER"],
    RUN_QUEUE: {} as DeploymentEnv["RUN_QUEUE"],
    ...overrides,
  };
}

test("resolveDefaultDeploymentBackendName uses workers-dispatch only when WFP is configured", () => {
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({
        CF_ACCOUNT_ID: "account",
        CF_API_TOKEN: "token",
        WFP_DISPATCH_NAMESPACE: "takos-tenants",
      }),
      "worker-bundle",
    ),
    "workers-dispatch",
  );
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({ CF_ACCOUNT_ID: "account", CF_API_TOKEN: "token" }),
      "worker-bundle",
    ),
    "runtime-host",
  );
});

test("resolveDefaultDeploymentBackendName keeps workload bundles on runtime-host without WFP env", () => {
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({}),
      "worker-bundle",
    ),
    "runtime-host",
  );
});

test("resolveDefaultDeploymentBackendName always realizes container images through the OCI orchestrator", () => {
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({}),
      "container-image",
    ),
    "oci",
  );
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({
        CF_ACCOUNT_ID: "account",
        CF_API_TOKEN: "token",
        WFP_DISPATCH_NAMESPACE: "takos-tenants",
      }),
      "container-image",
    ),
    "oci",
  );
});
