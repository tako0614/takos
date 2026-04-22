import { assertEquals } from "jsr:@std/assert";

import type { DeploymentEnv } from "../models.ts";
import { resolveDefaultDeploymentBackendName } from "../backend-defaults.ts";

function env(overrides: Partial<DeploymentEnv>): DeploymentEnv {
  return {
    DB: {} as DeploymentEnv["DB"],
    ADMIN_DOMAIN: "admin.example.com",
    HOSTNAME_ROUTING: {} as DeploymentEnv["HOSTNAME_ROUTING"],
    ...overrides,
  };
}

Deno.test("resolveDefaultDeploymentBackendName uses workers-dispatch only when WFP is configured", () => {
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

Deno.test("resolveDefaultDeploymentBackendName keeps worker bundles on runtime-host for k8s and S3-only envs", () => {
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({
        K8S_NAMESPACE: "takos",
        AWS_REGION: "us-east-1",
      }),
      "worker-bundle",
    ),
    "runtime-host",
  );
});

Deno.test("resolveDefaultDeploymentBackendName chooses container backend from concrete operator env", () => {
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({
        AWS_REGION: "us-east-1",
        AWS_ECS_CLUSTER_ARN: "cluster",
        AWS_ECS_TASK_DEFINITION_FAMILY: "takos",
      }),
      "container-image",
    ),
    "ecs",
  );
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({ GCP_PROJECT_ID: "project", GCP_REGION: "asia-northeast1" }),
      "container-image",
    ),
    "cloud-run",
  );
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({ K8S_NAMESPACE: "takos", AWS_REGION: "us-east-1" }),
      "container-image",
    ),
    "k8s",
  );
  assertEquals(
    resolveDefaultDeploymentBackendName(
      env({ AWS_REGION: "us-east-1" }),
      "container-image",
    ),
    "oci",
  );
});
