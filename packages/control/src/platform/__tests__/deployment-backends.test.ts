import { assertEquals } from "jsr:@std/assert";

import {
  resolveDeploymentBackendConfigsFromEnv,
} from "../deployment-backends.ts";

Deno.test("resolveDeploymentBackendConfigsFromEnv activates k8s only when K8S_NAMESPACE is present", () => {
  assertEquals(
    resolveDeploymentBackendConfigsFromEnv({
      K8S_DEPLOYMENT_NAME: "takos-worker",
      K8S_IMAGE_REGISTRY: "ghcr.io/takos",
    }),
    [],
  );

  assertEquals(
    resolveDeploymentBackendConfigsFromEnv({
      K8S_NAMESPACE: " takos ",
      K8S_DEPLOYMENT_NAME: " takos-worker ",
      K8S_IMAGE_REGISTRY: " ghcr.io/takos ",
    }),
    [
      {
        name: "k8s",
        config: {
          namespace: "takos",
          deploymentName: "takos-worker",
          imageRegistry: "ghcr.io/takos",
        },
      },
    ],
  );
});
