import { assertEquals, assertThrows } from "jsr:@std/assert";
import { parseAppManifestYaml } from "../app-manifest.ts";

Deno.test("public manifest contract - allows compute depends to reference compute entries", () => {
  const manifest = parseAppManifestYaml(`
name: notes-app
version: 0.1.0

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    depends:
      - api
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080

routes:
  - target: web
    path: /
`);

  assertEquals(manifest.compute.web.depends, ["api"]);
  assertEquals(manifest.compute.api.depends, undefined);
});

Deno.test("public manifest contract - parses worker with attached container and route publication", () => {
  const manifest = parseAppManifestYaml(`
name: notes-assistant
version: 0.3.0

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
        port: 3000
        consume:
          - publication: notes
            env:
              url: SANDBOX_MCP_URL

routes:
  - target: web
    path: /mcp

publish:
  - type: McpServer
    name: notes
    path: /mcp
    transport: streamable-http
`);

  assertEquals(manifest.compute.web.kind, "worker");
  assertEquals(
    manifest.compute.web.containers?.sandbox.kind,
    "attached-container",
  );
  assertEquals(
    manifest.compute.web.containers?.sandbox.consume,
    [{
      publication: "notes",
      env: {
        url: "SANDBOX_MCP_URL",
      },
    }],
  );
  assertEquals(manifest.publish[0]?.name, "notes");
});

Deno.test("public manifest contract - parses provider publications and compute consume", () => {
  const manifest = parseAppManifestYaml(`
name: publication-app

publish:
  - name: takos-api
    provider: takos
    kind: api
    spec:
      scopes:
        - files:read
  - name: app-oauth
    provider: takos
    kind: oauth-client
    spec:
      clientName: Notes App
      redirectUris:
        - https://example.com/oauth/callback
      scopes:
        - threads:read
      metadata:
        logoUri: https://example.com/logo.png

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
    consume:
      - publication: takos-api
      - publication: app-oauth
`);

  assertEquals(manifest.publish[0]?.spec, {
    scopes: ["files:read"],
  });
  assertEquals(manifest.publish[1]?.spec, {
    clientName: "Notes App",
    redirectUris: ["https://example.com/oauth/callback"],
    scopes: ["threads:read"],
    metadata: {
      logoUri: "https://example.com/logo.png",
    },
  });
  assertEquals(manifest.compute.web.consume, [
    { publication: "takos-api" },
    { publication: "app-oauth" },
  ]);
});

Deno.test("public manifest contract - rejects retired envelope schema", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: legacy-app
spec:
  compute: {}
`),
    Error,
    "Kubernetes-style manifest envelope is no longer supported",
  );
});

Deno.test("public manifest contract - rejects retired top-level scopes and oauth", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: legacy-app
scopes:
  - files:read
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
`),
    Error,
    "scopes is retired",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: legacy-app
oauth:
  redirectUris:
    - https://example.com/callback
  scopes:
    - threads:read
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
`),
    Error,
    "oauth is retired",
  );
});

Deno.test("public manifest contract - rejects retired storage", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: legacy-app
storage:
  db:
    type: sql
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
`),
    Error,
    "storage is retired",
  );
});

Deno.test("public manifest contract - rejects retired provider-specific fields outside spec", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: legacy-provider-app
publish:
  - name: takos-api
    provider: takos
    kind: api
    scopes:
      - files:read
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
`),
    Error,
    "is not supported by the publish/consume contract",
  );
});

Deno.test("public manifest contract - rejects retired compute capabilities", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: legacy-app
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
    capabilities:
      takosApi:
        scopes:
          - files:read
`),
    Error,
    "capabilities is retired",
  );
});

Deno.test("public manifest contract - rejects retired queue triggers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: legacy-queue-app
compute:
  worker:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
    triggers:
      queues:
        - storage: jobs
`),
    Error,
    "triggers.queues is retired",
  );
});
