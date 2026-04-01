import { assertEquals, assertThrows } from "jsr:@std/assert";

import {
  buildDeploymentArtifactRef,
  DeploymentService,
} from "@/services/deployment/service";

Deno.test("deployment service - builds artifact refs", () => {
  assertEquals(buildDeploymentArtifactRef("my-worker", 1), "my-worker-v1");
  assertEquals(buildDeploymentArtifactRef("", 1), "-v1");
});

Deno.test("deployment service - requires an encryption key", () => {
  assertThrows(
    () =>
      new DeploymentService({
        DB: {} as never,
        HOSTNAME_ROUTING: {} as never,
      } as never),
    Error,
    "ENCRYPTION_KEY must be set",
  );
});

Deno.test("deployment service - stores the constructor config on success", () => {
  const service = new DeploymentService({
    DB: {} as never,
    HOSTNAME_ROUTING: {} as never,
    ENCRYPTION_KEY: "test-key",
  } as never);

  assertEquals(service instanceof DeploymentService, true);
});
