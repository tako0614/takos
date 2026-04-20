import { assert, assertEquals, assertThrows } from "jsr:@std/assert";

import { parseAppManifestYaml } from "@/application/services/source/app-manifest.ts";

Deno.test("app manifest parses service and worker compute forms", () => {
  const manifest = parseAppManifestYaml(`
name: direct-artifact-app
version: 1.0.0
compute:
  api:
    image: ghcr.io/takos/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
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
  assertEquals(
    manifest.compute.api?.image,
    "ghcr.io/takos/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
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

Deno.test("app manifest parses Takos grants, consumes, and worker schedule triggers", () => {
  const manifest = parseAppManifestYaml(`
name: runtime-app
version: 1.0.0
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read
        - runs:write
  - name: app-oauth
    publisher: takos
    type: oauth-client
    spec:
      redirectUris:
        - https://example.com/callback
      scopes:
        - threads:read
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
    consume:
      - publication: takos-api
        env:
          endpoint: TAKOS_API_ENDPOINT
          apiKey: TAKOS_API_KEY
      - publication: app-oauth
`);

  assertEquals(manifest.publish, [
    {
      name: "takos-api",
      publisher: "takos",
      type: "api-key",
      spec: {
        scopes: ["files:read", "runs:write"],
      },
    },
    {
      name: "app-oauth",
      publisher: "takos",
      type: "oauth-client",
      spec: {
        redirectUris: ["https://example.com/callback"],
        scopes: ["threads:read"],
      },
    },
  ]);

  const apiCompute = manifest.compute.api;
  assert(apiCompute);
  assertEquals(apiCompute.kind, "worker");
  assertEquals(apiCompute.triggers, {
    schedules: [{ cron: "*/5 * * * *" }],
  });
  assertEquals(apiCompute.consume, [
    {
      publication: "takos-api",
      env: {
        endpoint: "TAKOS_API_ENDPOINT",
        apiKey: "TAKOS_API_KEY",
      },
    },
    { publication: "app-oauth" },
  ]);
});
