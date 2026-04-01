import {
  assert,
  assertEquals,
  assertThrows,
} from "jsr:@std/assert";

import {
  appManifestToBundleDocs,
  parseAppManifestYaml,
} from "@/application/services/source/app-manifest.ts";

Deno.test("parseAppManifestYaml parses a minimal service + worker manifest", () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: service-app
spec:
  version: 1.0.0
  services:
    my-api:
      dockerfile: Dockerfile
      port: 3000
      ipv4: true
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js
`);

  assert(manifest.spec.services);
  assert(manifest.spec.workers);
  assertEquals(manifest.spec.services["my-api"]?.port, 3000);
  assertEquals(manifest.spec.services["my-api"]?.ipv4, true);
  assertEquals(
    manifest.spec.workers.web?.build?.fromWorkflow.path,
    ".takos/workflows/build.yml",
  );
});

Deno.test("parseAppManifestYaml rejects unsupported local worker build fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: invalid-app
spec:
  version: 1.0.0
  workers:
    web:
      entry: src/index.ts
`),
    Error,
    "local build fields are not supported",
  );
});

Deno.test("parseAppManifestYaml rejects invalid update strategies", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: invalid-update
spec:
  version: 1.0.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js
  update:
    strategy: yolo
`),
    Error,
    "spec.update.strategy must be",
  );
});

Deno.test("appManifestToBundleDocs emits docs for parsed manifests", () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: docs-app
spec:
  version: 1.0.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js
`);

  const docs = appManifestToBundleDocs(
    manifest,
    new Map([
      ["web", {
        service_name: "web",
        workflow_path: ".takos/workflows/build.yml",
        workflow_job: "build",
        workflow_artifact: "dist",
        artifact_path: "dist/worker.js",
      }],
    ]),
  );

  assert(docs.length > 0);
  assertEquals(docs[0]?.kind, "Package");
  assertEquals(docs[0]?.metadata.name, "docs-app");
});
