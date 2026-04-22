import { assertThrows } from "jsr:@std/assert";

import { serializeDeploymentBackendTarget } from "../backend-targets.ts";

Deno.test("serializeDeploymentBackendTarget rejects unknown backend names", () => {
  assertThrows(
    () =>
      serializeDeploymentBackendTarget({
        backend: { name: "not-a-backend" as never },
      }),
    Error,
    "Unsupported deployment backend: not-a-backend",
  );
});
