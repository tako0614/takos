import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertThrows,
} from "jsr:@std/assert";

import { parseAppManifestYaml } from "@/application/services/source/app-manifest.ts";

Deno.test("app manifest parses service and worker compute forms", () => {
  const manifest = parseAppManifestYaml(`
name: direct-artifact-app
version: 1.0.0
compute:
  api:
    image: ghcr.io/takos/api:latest
    port: 8080
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-web
        artifact: worker-web-v1
        artifactPath: dist/worker.js
`);

  assertEquals(manifest.compute.api?.kind, "service");
  assertEquals(manifest.compute.api?.image, "ghcr.io/takos/api:latest");
  assertEquals(manifest.compute.api?.port, 8080);

  assertEquals(manifest.compute.web?.kind, "worker");
  assertEquals(
    manifest.compute.web?.build?.fromWorkflow,
    {
      path: ".takos/workflows/build.yml",
      job: "build-web",
      artifact: "worker-web-v1",
      artifactPath: "dist/worker.js",
    },
  );
});

Deno.test("app manifest rejects compute entries without build or image", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: broken-app
version: 1.0.0
compute:
  api:
    env:
      FOO: bar
`),
    Error,
    "must define 'build' (worker) or 'image' (service)",
  );
});

Deno.test("app manifest parses runtime storage and worker queue triggers", () => {
  const manifest = parseAppManifestYaml(`
name: runtime-app
version: 1.0.0
storage:
  jobs:
    type: queue
    bind: JOBS
    queue:
      maxRetries: 5
  events:
    type: analytics-engine
    bind: ANALYTICS
  onboarding:
    type: workflow
    bind: ONBOARDING_FLOW
    workflow:
      class: OnboardingWorkflow
      script: api
compute:
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build-api
        artifact: api-dist
        artifactPath: dist/api.mjs
    triggers:
      schedules:
        - cron: "*/5 * * * *"
      queues:
        - storage: jobs
`);

  assertObjectMatch(manifest.storage ?? {}, {
    jobs: {
      type: "queue",
      bind: "JOBS",
      queue: {
        maxRetries: 5,
      },
    },
    events: {
      type: "analytics-engine",
      bind: "ANALYTICS",
    },
    onboarding: {
      type: "workflow",
      bind: "ONBOARDING_FLOW",
      workflow: {
        class: "OnboardingWorkflow",
        script: "api",
      },
    },
  });

  const apiCompute = manifest.compute.api;
  assert(apiCompute);
  assertEquals(apiCompute.kind, "worker");
  assertEquals(apiCompute.triggers, {
    schedules: [{ cron: "*/5 * * * *" }],
    queues: [{ storage: "jobs" }],
  });
});
