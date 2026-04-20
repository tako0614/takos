import { assertEquals, assertRejects } from "jsr:@std/assert";

import { DeploymentService } from "../service.ts";
import { deploymentStoreDeps } from "../store.ts";
import type { DeploymentEnv } from "../models.ts";

const originalGetDb = deploymentStoreDeps.getDb;

function makeEnv(overrides: Partial<DeploymentEnv> = {}): DeploymentEnv {
  return {
    DB: {} as DeploymentEnv["DB"],
    ENCRYPTION_KEY: "test-encryption-key",
    ADMIN_DOMAIN: "admin.example.test",
    HOSTNAME_ROUTING: {} as DeploymentEnv["HOSTNAME_ROUTING"],
    ROUTING_DO: {} as DeploymentEnv["ROUTING_DO"],
    ...overrides,
  } as DeploymentEnv;
}

Deno.test("DeploymentService.createDeployment fails fast when worker bundle storage is missing", async () => {
  const env = makeEnv();
  const service = new DeploymentService(env);
  let dbAccessed = false;
  deploymentStoreDeps.getDb = (() => {
    dbAccessed = true;
    throw new Error("db should not be accessed");
  }) as typeof deploymentStoreDeps.getDb;

  try {
    await assertRejects(
      () =>
        service.createDeployment({
          spaceId: "space-1",
          serviceId: "service-1",
          bundleContent: "export default {}",
        }),
      Error,
      "WORKER_BUNDLES must be configured for worker-bundle deployments",
    );
  } finally {
    deploymentStoreDeps.getDb = originalGetDb;
  }
  assertEquals(dbAccessed, false);
});
