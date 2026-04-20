import { assertEquals } from "jsr:@std/assert";

import {
  validateDeploymentQueueEnv,
  validateWorkflowRunnerEnv,
} from "../validate-env.ts";

Deno.test("validateWorkflowRunnerEnv only requires DB", () => {
  assertEquals(
    validateWorkflowRunnerEnv({
      DB: {},
    }),
    null,
  );
});

Deno.test("validateDeploymentQueueEnv fails when deployment queue env is incomplete", () => {
  assertEquals(
    validateDeploymentQueueEnv({
      DB: {},
    }),
    "[takos-deployment-queue] Missing required environment bindings: ENCRYPTION_KEY, HOSTNAME_ROUTING",
  );
});

Deno.test("validateDeploymentQueueEnv accepts deployment queue env with the required bindings", () => {
  assertEquals(
    validateDeploymentQueueEnv({
      DB: {},
      ENCRYPTION_KEY: "secret",
      HOSTNAME_ROUTING: {},
    }),
    null,
  );
});
