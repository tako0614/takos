import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertThrows,
} from "jsr:@std/assert";

import { parseAppManifestYaml } from "@/application/services/source/app-manifest.ts";

Deno.test("app manifest parses service and direct-artifact worker forms", () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: direct-artifact-app
spec:
  version: 1.0.0
  services:
    api:
      port: 8080
      artifact:
        kind: image
        imageRef: ghcr.io/takos/api:latest
        provider: k8s
  workers:
    web:
      artifact:
        kind: bundle
        deploymentId: dep-web-1
        artifactRef: worker-web-v1
`);

  assertEquals(manifest.spec.services?.api, {
    port: 8080,
    artifact: {
      kind: "image",
      imageRef: "ghcr.io/takos/api:latest",
      provider: "k8s",
    },
  });
  assertEquals(manifest.spec.workers?.web, {
    artifact: {
      kind: "bundle",
      deploymentId: "dep-web-1",
      artifactRef: "worker-web-v1",
    },
  });
});

Deno.test("app manifest rejects legacy local build fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-app
spec:
  version: 1.0.0
  workers:
    api:
      build:
        command: pnpm build
        output: dist/api.mjs
`),
    Error,
    "local build fields are not supported",
  );
});

Deno.test("app manifest parses runtime resources and worker bindings", () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: runtime-app
spec:
  version: 1.0.0
  services:
    api:
      port: 8080
      dockerfile: Dockerfile
  resources:
    jobs:
      type: queue
      binding: JOBS
      queue:
        maxRetries: 5
        deliveryDelaySeconds: 10
    events:
      type: analyticsEngine
      binding: ANALYTICS
      analyticsEngine:
        dataset: tenant-events
    onboarding:
      type: workflow
      binding: ONBOARDING_FLOW
      workflow:
        service: api
        export: runOnboarding
        timeoutMs: 60000
        maxRetries: 3
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
      bindings:
        queues: [jobs]
        analyticsEngine: [events]
        workflow: [onboarding]
      triggers:
        schedules:
          - cron: "*/5 * * * *"
            export: handleCron
        queues:
          - queue: jobs
            export: handleJob
`);

  assertObjectMatch(manifest.spec.resources ?? {}, {
    jobs: {
      type: "queue",
      binding: "JOBS",
      queue: {
        maxRetries: 5,
        deliveryDelaySeconds: 10,
      },
    },
    events: {
      type: "analyticsEngine",
      binding: "ANALYTICS",
      analyticsEngine: {
        dataset: "tenant-events",
      },
    },
    onboarding: {
      type: "workflow",
      binding: "ONBOARDING_FLOW",
      workflow: {
        service: "api",
        export: "runOnboarding",
        timeoutMs: 60000,
        maxRetries: 3,
      },
    },
  });

  const apiWorker = manifest.spec.workers?.api;
  assert(apiWorker);
  assertObjectMatch(apiWorker.bindings ?? {}, {
    queues: ["jobs"],
    analyticsEngine: ["events"],
    workflow: ["onboarding"],
  });
  assertEquals(apiWorker.triggers, {
    schedules: [{ cron: "*/5 * * * *", export: "handleCron" }],
    queues: [{ queue: "jobs", export: "handleJob" }],
  });
});
