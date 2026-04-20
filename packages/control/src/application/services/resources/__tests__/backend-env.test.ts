import { assertEquals } from "jsr:@std/assert";

import type { Env } from "../../../../shared/types/index.ts";
import { inferDefaultManagedResourceBackend } from "../lifecycle.ts";
import { inferResourceBackend } from "../../../../server/routes/resources/route-helpers.ts";

Deno.test("resource backend inference only activates k8s on K8S_NAMESPACE", () => {
  const k8sOnlyOptionalConfig = {
    K8S_DEPLOYMENT_NAME: "takos-worker",
    K8S_IMAGE_REGISTRY: "ghcr.io/takos",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(
      k8sOnlyOptionalConfig as Partial<Env>,
    ),
    "local",
  );
  assertEquals(
    inferResourceBackend(k8sOnlyOptionalConfig as never),
    "local",
  );

  const k8sActivated = {
    K8S_NAMESPACE: "takos",
    K8S_DEPLOYMENT_NAME: "takos-worker",
    K8S_IMAGE_REGISTRY: "ghcr.io/takos",
  };

  assertEquals(
    inferDefaultManagedResourceBackend(k8sActivated as Partial<Env>),
    "k8s",
  );
  assertEquals(
    inferResourceBackend(k8sActivated as never),
    "k8s",
  );
});
