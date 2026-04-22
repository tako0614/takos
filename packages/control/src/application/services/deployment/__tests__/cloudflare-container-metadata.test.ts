import { assertEquals } from "jsr:@std/assert";

import {
  buildNativeCloudflareContainerBindings,
  buildNativeCloudflareWorkerMetadata,
} from "../cloudflare-container-metadata.ts";
import type { AppCompute } from "../../source/app-manifest-types.ts";

const workerSpec: AppCompute & { kind: "worker" } = {
  kind: "worker",
  containers: {
    sandbox: {
      kind: "attached-container",
      image: "apps/sandbox/Dockerfile",
      port: 8080,
      cloudflare: {
        container: {
          binding: "SANDBOX_CONTAINER",
          className: "SandboxSessionContainer",
          instanceType: "basic",
          maxInstances: 100,
          imageBuildContext: ".",
          migrationTag: "v1",
        },
      },
    },
  },
};

Deno.test("native Cloudflare container metadata emits DO binding, container config, and migration", () => {
  assertEquals(buildNativeCloudflareContainerBindings(workerSpec), [
    {
      type: "durable_object_namespace",
      name: "SANDBOX_CONTAINER",
      class_name: "SandboxSessionContainer",
    },
  ]);

  assertEquals(buildNativeCloudflareWorkerMetadata(workerSpec), {
    containers: [
      {
        class_name: "SandboxSessionContainer",
        image: "apps/sandbox/Dockerfile",
        instance_type: "basic",
        max_instances: 100,
        image_build_context: ".",
      },
    ],
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: ["SandboxSessionContainer"],
      },
    ],
  });
});
