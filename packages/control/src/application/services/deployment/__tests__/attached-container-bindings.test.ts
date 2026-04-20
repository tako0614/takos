import { assertEquals, assertThrows } from "jsr:@std/assert";

import {
  injectAttachedContainerBindings,
  resolveAttachedContainerBindingPlans,
} from "../attached-container-bindings.ts";
import type { ObservedGroupState } from "../group-state.ts";

function observedState(): ObservedGroupState {
  return {
    groupId: "group-1",
    groupName: "demo",
    backend: "local",
    env: "default",
    updatedAt: "2026-04-12T00:00:00.000Z",
    resources: {},
    routes: {},
    workloads: {
      "web-worker": {
        serviceId: "service-worker",
        name: "web-worker",
        category: "container",
        status: "deployed",
        workloadKind: "container-image",
        resolvedBaseUrl: "http://127.0.0.1:9321",
        updatedAt: "2026-04-12T00:00:00.000Z",
      },
    },
  };
}

Deno.test("attached container binding plans use documented worker binding names", () => {
  const plans = resolveAttachedContainerBindingPlans(
    "web",
    {
      kind: "worker",
      build: {
        fromWorkflow: {
          path: ".takos/workflows/deploy.yml",
          job: "build",
          artifact: "host",
          artifactPath: "dist/host.js",
        },
      },
      containers: {
        worker: {
          kind: "attached-container",
          image:
            "ghcr.io/example/worker@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    },
    observedState(),
  );

  assertEquals(plans, [{
    childName: "worker",
    workloadName: "web-worker",
    bindingName: "WORKER_CONTAINER",
    urlEnvName: "__TAKOS_ATTACHED_CONTAINER_WORKER_URL",
    className: "__TakosAttachedContainer_worker",
    baseUrl: "http://127.0.0.1:9321",
  }]);
});

Deno.test("attached container binding injection adds DO namespace and endpoint bindings", () => {
  const plans = resolveAttachedContainerBindingPlans(
    "web",
    {
      kind: "worker",
      build: {
        fromWorkflow: {
          path: ".takos/workflows/deploy.yml",
          job: "build",
          artifact: "host",
          artifactPath: "dist/host.js",
        },
      },
      containers: {
        worker: {
          kind: "attached-container",
          image:
            "ghcr.io/example/worker@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    },
    observedState(),
  );

  const injected = injectAttachedContainerBindings({
    bundleContent: "export default { fetch() { return new Response('ok'); } };",
    bindings: [],
    plans,
  });

  assertEquals(
    injected.bundleContent.includes(
      "export class __TakosAttachedContainer_worker",
    ),
    true,
  );
  assertEquals(injected.bindings, [
    {
      type: "plain_text",
      name: "__TAKOS_ATTACHED_CONTAINER_WORKER_URL",
      text: "http://127.0.0.1:9321",
    },
    {
      type: "durable_object_namespace",
      name: "WORKER_CONTAINER",
      class_name: "__TakosAttachedContainer_worker",
    },
  ]);
});

Deno.test("attached container binding injection rejects binding name conflicts", () => {
  const plans = resolveAttachedContainerBindingPlans(
    "web",
    {
      kind: "worker",
      build: {
        fromWorkflow: {
          path: ".takos/workflows/deploy.yml",
          job: "build",
          artifact: "host",
          artifactPath: "dist/host.js",
        },
      },
      containers: {
        worker: {
          kind: "attached-container",
          image:
            "ghcr.io/example/worker@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        },
      },
    },
    observedState(),
  );

  assertThrows(
    () =>
      injectAttachedContainerBindings({
        bundleContent: "export default {};",
        bindings: [{
          type: "plain_text",
          name: "WORKER_CONTAINER",
          text: "reserved",
        }],
        plans,
      }),
    Error,
    "conflicts with an existing worker binding",
  );
});
