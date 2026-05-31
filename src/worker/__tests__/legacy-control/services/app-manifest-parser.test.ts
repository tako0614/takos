import { assert, assertEquals, assertThrows } from "@std/assert";

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
    kind: worker
`);

  assert(manifest.compute);
  assertEquals(manifest.compute["my-api"]?.kind, "service");
  assertEquals(manifest.compute["my-api"]?.port, 3000);
  assertEquals(manifest.compute.web?.kind, "worker");
  assertEquals(manifest.compute.web?.image, undefined);
});

Deno.test("parseAppManifestYaml rejects envelope-shaped manifests", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
apiVersion: example.com/v1
metadata:
  name: invalid-app
spec:
  version: 1.0.0
  workers:
    web:
      entry: src/index.ts
`),
    Error,
    "Takos app manifests use the flat contract",
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
    kind: worker
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
    kind: worker
`);

  const docs = appManifestToBundleDocs(
    manifest,
    new Map([
      ["web", {
        service_name: "web",
        artifact_path: "dist/worker.js",
      }],
    ]),
  );

  assert(docs.length > 0);
  assertEquals(docs[0]?.type, "Package");
  assertEquals(docs[0]?.name, "docs-app");
  assertEquals(docs[1]?.labels, {
    artifact_path: "dist/worker.js",
  });
});
