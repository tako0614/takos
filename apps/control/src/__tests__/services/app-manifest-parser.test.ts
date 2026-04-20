import { assert, assertEquals, assertThrows } from "jsr:@std/assert";

import {
  appManifestToBundleDocs,
  parseAppManifestYaml,
} from "@/application/services/source/app-manifest.ts";

Deno.test("parseAppManifestYaml parses a minimal service + worker manifest", () => {
  const manifest = parseAppManifestYaml(`
name: service-app
version: 1.0.0
compute:
  my-api:
    image: ghcr.io/takos/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    port: 3000
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build
        artifact: dist
        artifactPath: dist/worker.js
`);

  assert(manifest.compute);
  assertEquals(manifest.compute["my-api"]?.kind, "service");
  assertEquals(manifest.compute["my-api"]?.port, 3000);
  assertEquals(manifest.compute.web?.kind, "worker");
  assertEquals(
    manifest.compute.web?.build?.fromWorkflow.path,
    ".takos/workflows/build.yml",
  );
});

Deno.test("parseAppManifestYaml rejects envelope-shaped manifests", () => {
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
    "apiVersion is not supported by the app manifest contract",
  );
});

Deno.test("parseAppManifestYaml rejects invalid semver versions", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: invalid-version
version: not-a-version
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/build.yml
        job: build
        artifact: dist
        artifactPath: dist/worker.js
`),
    Error,
  );
});

Deno.test("appManifestToBundleDocs emits docs for parsed manifests", () => {
  const manifest = parseAppManifestYaml(`
name: docs-app
version: 1.0.0
compute:
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
