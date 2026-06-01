import { test } from "bun:test";
import { assertThrows } from "@takos/test/assert";

import { serializeDeploymentBackendTarget } from "../backend-targets.ts";

test("serializeDeploymentBackendTarget rejects unknown backend names", () => {
  assertThrows(
    () =>
      serializeDeploymentBackendTarget({
        backend: { name: "not-a-backend" as never },
      }),
    Error,
    "Unsupported deployment backend: not-a-backend",
  );
});
