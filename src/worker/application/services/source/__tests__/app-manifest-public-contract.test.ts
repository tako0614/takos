import { test } from "bun:test";
import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@takos/test/assert";
import { applyManifestOverrides } from "../../deployment/group-state.ts";
import {
  assertManifestInputDoesNotUseBuildMetadata,
  parseAppManifestYaml,
} from "../app-manifest.ts";

test("public source contract - rejects compute.build.fromWorkflow", () => {
  const error = assertThrows(() =>
    parseAppManifestYaml(`
name: rejected-build-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web

routes:
  - id: launcher
    target: web
    path: /
`),
  ) as Error;

  assertStringIncludes(error.message, "compute.web.build");
  assertStringIncludes(error.message, "no longer supported");
  assertStringIncludes(error.message, "Takosumi OpenTofu module plan Run flow");
});

test("public source contract - rejects override build.fromWorkflow", () => {
  const error = assertThrows(() =>
    parseAppManifestYaml(`
name: override-rejected-build-app

compute:
  web:
    image: ghcr.io/org/web@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080

routes:
  - target: web
    path: /

overrides:
  staging:
    compute:
      web:
        build:
          fromWorkflow:
            path: .takos/workflows/deploy.yml
            job: bundle
            artifact: web
`),
  ) as Error;

  assertStringIncludes(error.message, "overrides.compute.web.build");
  assertStringIncludes(error.message, "no longer supported");
  assertStringIncludes(error.message, "Takosumi OpenTofu module plan Run flow");
});

test("public source contract - raw source objects reject legacy build metadata", () => {
  const error = assertThrows(() =>
    assertManifestInputDoesNotUseBuildMetadata({
      name: "raw-legacy-disabled-app",
      compute: {
        web: {
          build: {
            fromWorkflow: {
              path: ".takos/workflows/deploy.yml",
              job: "bundle",
              artifact: "web",
            },
          },
        },
      },
    }),
  ) as Error;

  assertStringIncludes(error.message, "compute.web.build");
  assertStringIncludes(error.message, "no longer supported");
  assertStringIncludes(error.message, "Takosumi OpenTofu module plan Run flow");
});

test("public source contract - allows compute depends to reference compute entries", () => {
  const manifest = parseAppManifestYaml(`
name: notes-app
version: 0.1.0

compute:
  web:
    kind: worker
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

test("public source contract - accepts explicit worker compute without build metadata", () => {
  const manifest = parseAppManifestYaml(`
name: worker-artifact-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /
`);

  assertEquals(manifest.compute.web.kind, "worker");
  assertEquals(manifest.compute.web.image, undefined);
});

test("public source contract - parses worker with attached container and route publication", () => {
  const manifest = parseAppManifestYaml(`
name: notes-assistant
version: 0.3.0

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
        port: 3000
        consume:
          - publication: notes
            inject:
              env:
                url: SANDBOX_MCP_URL

routes:
  - id: mcp
    target: web
    path: /mcp

publish:
  - type: com.example.McpEndpoint
    name: notes
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      protocol: streamable-http
`);

  assertEquals(manifest.compute.web.kind, "worker");
  assertEquals(
    manifest.compute.web.containers?.sandbox.kind,
    "attached-container",
  );
  assertEquals(manifest.compute.web.containers?.sandbox.consume, [
    {
      publication: "notes",
      inject: {
        env: {
          url: "SANDBOX_MCP_URL",
        },
      },
    },
  ]);
  assertEquals(manifest.publish[0]?.name, "notes");
  assertEquals(manifest.publish[0]?.publisher, "web");
  assertEquals(manifest.publish[0]?.outputs, {
    url: { kind: "url", routeRef: "mcp" },
  });
  assertEquals(manifest.publish[0]?.spec, { protocol: "streamable-http" });
});

test("public source contract - rejects routes targeting attached containers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-route-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
        port: 3000

routes:
  - target: sandbox
    path: /sandbox
`),
    Error,
    "routes[0].target references attached container compute",
  );
});

test("public source contract - rejects duplicate route target/path entries during parse", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: duplicate-route-app

compute:
  web:
    kind: worker

routes:
  - id: mcp
    target: web
    path: /mcp
    methods:
      - GET
  - target: web
    path: /mcp
    methods:
      - POST
`),
    Error,
    "route target/path 'web /mcp' duplicates routes[0]",
  );
});

test("public source contract - rejects overlapping route paths during parse", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: overlapping-route-app

compute:
  web:
    kind: worker
  api:
    kind: worker

routes:
  - target: web
    path: /mcp
    methods:
      - GET
  - target: api
    path: /mcp
`),
    Error,
    "route path '/mcp' overlaps routes[0] for method GET",
  );
});

test("public source contract - rejects Takos publications in Capsule desired-state projections during parse", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-takos-publication-app

publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec: {}

compute:
  web:
    kind: worker
`),
    Error,
    "publish[0].publisher 'takos' is not supported in Capsule desired-state projections",
  );
});

test("public source contract - rejects invalid route timeoutMs", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-route-timeout-app

compute:
  web:
    kind: worker

routes:
  - id: launcher
    target: web
    path: /
    timeoutMs: nope
`),
    Error,
    "routes[0].timeoutMs must be an integer",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: negative-route-timeout-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /
    timeoutMs: 0
`),
    Error,
    "routes[0].timeoutMs must be >= 1",
  );
});

test("public source contract - uppercases route methods during parse", () => {
  const manifest = parseAppManifestYaml(`
name: method-normalization-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /api
    methods:
      - get
      - post
`);

  assertEquals(manifest.routes[0]?.methods, ["GET", "POST"]);
});

test("public source contract - rejects unsupported legacy route fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-route-fields-app

compute:
  web:
    kind: worker

routes:
  - name: route-name
    target: web
    path: /
`),
    Error,
    "routes[0].name is not supported by the Capsule desired-state projection contract",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-route-fields-app

compute:
  web:
    kind: worker

routes:
  - ingress: public
    target: web
    path: /
`),
    Error,
    "routes[0].ingress is not supported by the Capsule desired-state projection contract",
  );
});

test("public source contract - defers override route target validation to apply time", () => {
  const manifest = parseAppManifestYaml(`
name: override-route-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /

overrides:
  staging:
    routes:
      - target: api
        path: /api
`);

  assertEquals(manifest.overrides?.staging?.routes, [
    {
      target: "api",
      path: "/api",
    },
  ]);

  assertThrows(
    () => applyManifestOverrides(manifest, "staging"),
    Error,
    "routes[0].target references unknown compute: api",
  );
});

test("public source contract - accepts partial compute overrides and deep merges them at apply time", () => {
  const manifest = parseAppManifestYaml(`
name: override-compute-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /

overrides:
  production:
    compute:
      web:
        scaling:
          minInstances: 2
`);

  assertEquals(manifest.overrides?.production?.compute?.web?.scaling, {
    minInstances: 2,
  });

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(resolved.compute.web.kind, "worker");
  assertEquals(resolved.compute.web.scaling, { minInstances: 2 });
});

test("public source contract - accepts queue trigger overrides", () => {
  const manifest = parseAppManifestYaml(`
name: override-queue-trigger-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /

overrides:
  production:
    compute:
      web:
        triggers:
          queues:
            - binding: delivery_queue
              deadLetterQueue: DELIVERY_DLQ
              maxBatchSize: 10
              maxRetries: 3
`);

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(resolved.compute.web.triggers?.queues, [
    {
      binding: "DELIVERY_QUEUE",
      deadLetterQueue: "DELIVERY_DLQ",
      maxBatchSize: 10,
      maxRetries: 3,
    },
  ]);
});

test("public source contract - validates compute overrides after merge", () => {
  const serviceManifest = parseAppManifestYaml(`
name: override-service-readiness-app

compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080

routes:
  - target: api
    path: /

overrides:
  production:
    compute:
      api:
        readiness: /ready
`);

  assertThrows(
    () => applyManifestOverrides(serviceManifest, "production"),
    Error,
    "compute.api.readiness is not supported for service compute; readiness is worker-only",
  );

  const workerManifest = parseAppManifestYaml(`
name: override-worker-health-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /

overrides:
  production:
    compute:
      web:
        healthCheck:
          path: /healthz
`);

  assertThrows(
    () => applyManifestOverrides(workerManifest, "production"),
    Error,
    "compute.web.healthCheck is not supported for worker compute",
  );

  const dependsManifest = parseAppManifestYaml(`
name: override-bad-depends-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /

overrides:
  production:
    compute:
      web:
        depends:
          - api
`);

  assertThrows(
    () => applyManifestOverrides(dependsManifest, "production"),
    Error,
    "compute.web.depends references unknown compute: api",
  );
});

test("public source contract - rejects unnamed publish overrides", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: override-publish-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /mcp

publish:
  - name: notes
    type: com.example.McpEndpoint
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      protocol: streamable-http

overrides:
  production:
    publish:
      - display:
          title: Production Notes
`),
    Error,
    "overrides.publish[0].name is required",
  );
});

test("public source contract - merges named publish overrides", () => {
  const manifest = parseAppManifestYaml(`
name: named-publish-override-app

compute:
  web:
    kind: worker

routes:
  - id: mcp
    target: web
    path: /mcp
  - id: assets
    target: web
    path: /assets

publish:
  - name: notes
    type: com.example.McpEndpoint
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      protocol: streamable-http
  - name: assets
    type: com.example.FileEndpoint
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: assets
    spec:
      contentTypes:
        - image/png

overrides:
  production:
    publish:
      - name: assets
        display:
          title: Production Assets
`);

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(resolved.publish, [
    {
      name: "notes",
      type: "com.example.McpEndpoint",
      publisher: "web",
      outputs: { url: { kind: "url", routeRef: "mcp" } },
      spec: { protocol: "streamable-http" },
    },
    {
      name: "assets",
      type: "com.example.FileEndpoint",
      publisher: "web",
      outputs: { url: { kind: "url", routeRef: "assets" } },
      spec: { contentTypes: ["image/png"] },
      display: { title: "Production Assets" },
    },
  ]);
});

test("public source contract - canonicalizes publish override standard types", () => {
  const manifest = parseAppManifestYaml(`
name: override-publish-canonical-app

compute:
  web:
    kind: worker

routes:
  - id: files
    target: web
    path: /files

publish:
  - name: notes
    type: protocol.mcp.server
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: files

overrides:
  production:
    publish:
      - name: handler
        type: interface.file.handler
        publisher: web
        outputs:
          url:
            kind: url
            routeRef: files
        spec:
          extensions:
            - .md
`);

  // The override delta is parsed by the canonical parser in partial mode, so the
  // standard short type name is expanded just like a top-level publication.
  assertEquals(manifest.publish[0]?.type, "protocol.mcp.server");
  assertEquals(
    manifest.overrides?.production?.publish?.[0]?.type,
    "interface.file.handler",
  );
});

test("public source contract - validates FileHandler publish overrides", () => {
  // The override copy of the publish parser used to skip interface.file.handler spec
  // validation; it now runs uniformly, so a interface.file.handler override without
  // mimeTypes/extensions is rejected the same way a top-level one is.
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: override-file-handler-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /files

overrides:
  production:
    publish:
      - name: handler
        type: interface.file.handler
`),
    Error,
    "overrides.publish[0].spec.mimeTypes or overrides.publish[0].spec.extensions is required for interface.file.handler",
  );
});

test("public source contract - validates publish override outputs", () => {
  // Outputs supplied in an override delta go through the canonical strong
  // output validator (routeRef required), which the old override copy skipped.
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: override-output-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /mcp

overrides:
  production:
    publish:
      - name: notes
        outputs:
          url:
            kind: url
`),
    Error,
    "overrides.publish[0].outputs.url.routeRef is required",
  );
});

test("public source contract - rejects unsupported fields in overrides", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: override-unsupported-field-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /

overrides:
  production:
    storage:
      placeholder: {}
`),
    Error,
    "overrides.production.storage is not supported by the override contract",
  );
});

test("public source contract - rejects readiness on non-worker compute", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: service-readiness-app

compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
    readiness: /ready

routes:
  - target: api
    path: /
`),
    Error,
    "compute.api.readiness is not supported for service compute; readiness is worker-only",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-readiness-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
        dockerfile: ./containers/sandbox.Dockerfile
        port: 3000
        readiness: /ready

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.containers.sandbox.readiness is not supported for attached container compute; readiness is worker-only",
  );
});

test("public source contract - requires digest-pinned image refs", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: mutable-service-image-app

compute:
  api:
    image: ghcr.io/org/api:latest
    port: 8080

routes:
  - target: api
    path: /
`),
    Error,
    "compute.api.image must be a digest-pinned image ref",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: mutable-attached-image-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox:latest
        dockerfile: containers/sandbox.Dockerfile

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.containers.sandbox.image must be a digest-pinned image ref",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: mutable-override-image-app

compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080

routes:
  - target: api
    path: /

overrides:
  production:
    compute:
      api:
        image: ghcr.io/org/api:latest
`),
    Error,
    "overrides.compute.api.image must be a digest-pinned image ref",
  );
});

test("public source contract - rejects non-portable compute tuning fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: instance-type-app

compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    instanceType: c7g.large
`),
    Error,
    "compute.api.instanceType is not supported by the Capsule desired-state projection contract",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: scaling-extra-app

compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
    scaling:
      minInstances: 1
      cpu: 2
`),
    Error,
    "compute.api.scaling.cpu is not supported by the Capsule desired-state projection contract",
  );
});

test("public source contract - allows image-backed attached containers with dockerfile metadata", () => {
  const manifest = parseAppManifestYaml(`
name: attached-image-dockerfile-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210
        dockerfile: ./containers//sandbox.Dockerfile
        port: 3000

routes:
  - target: web
    path: /
`);

  assertEquals(
    manifest.compute.web.containers?.sandbox.kind,
    "attached-container",
  );
  assertEquals(
    manifest.compute.web.containers?.sandbox.image,
    "ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
  );
  assertEquals(
    manifest.compute.web.containers?.sandbox.dockerfile,
    "containers/sandbox.Dockerfile",
  );
});

test("public source contract - allows native Cloudflare container metadata", () => {
  const manifest = parseAppManifestYaml(`
name: native-cloudflare-container-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: apps/sandbox/Dockerfile
        dockerfile: apps/sandbox/Dockerfile
        port: 8080
        cloudflare:
          container:
            binding: SANDBOX_CONTAINER
            className: SandboxSessionContainer
            instanceType: basic
            maxInstances: 100
            imageBuildContext: .
            migrationTag: v1

routes:
  - target: web
    path: /
`);

  const sandbox = manifest.compute.web.containers?.sandbox;
  assertEquals(sandbox?.image, "apps/sandbox/Dockerfile");
  assertEquals(sandbox?.cloudflare?.container, {
    binding: "SANDBOX_CONTAINER",
    className: "SandboxSessionContainer",
    instanceType: "basic",
    maxInstances: 100,
    imageBuildContext: ".",
    migrationTag: "v1",
  });
});

test("public source contract - rejects quoted Cloudflare container booleans", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: native-cloudflare-container-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: apps/sandbox/Dockerfile
        port: 8080
        cloudflare:
          container:
            className: SandboxSessionContainer
            sqlite: "false"
`),
    Error,
    "compute.web.containers.sandbox.cloudflare.container.sqlite must be a boolean",
  );
});

test("public source contract - parses managed resources and bindings", () => {
  const manifest = parseAppManifestYaml(`
name: resource-app

compute:
  web:
    kind: worker

resources:
  session-index:
    type: key-value
    bindings:
      web: SESSION_INDEX
  host-token:
    type: secret
    generate: true
    bind: SANDBOX_HOST_AUTH_TOKEN
    to: web

routes:
  - target: web
    path: /
`);

  assertEquals(manifest.resources?.["session-index"].bindings, [
    {
      target: "web",
      binding: "SESSION_INDEX",
    },
  ]);
  assertEquals(manifest.resources?.["host-token"].bindings, [
    {
      target: "web",
      binding: "SANDBOX_HOST_AUTH_TOKEN",
    },
  ]);
});

test("public source contract - rejects quoted resource generate booleans", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-resource-app

compute:
  web:
    kind: worker

resources:
  token:
    type: secret
    generate: "false"
    bind: APP_TOKEN
    to: web
`),
    Error,
    "resources.token.generate must be a boolean",
  );
});

test("public source contract - rejects resource migration fields", () => {
  const error = assertThrows(() =>
    parseAppManifestYaml(`
name: bad-resource-app

compute:
  web:
    kind: worker

resources:
  app-db:
    type: sql
    bind: DB
    to: web
    migrations: migrations
`),
  ) as Error;

  assertStringIncludes(error.message, "resources.app-db.migrations");
  assertStringIncludes(
    error.message,
    "not supported by the Capsule desired-state projection contract",
  );
});

test("public source contract - rejects resource bindings to unknown compute", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-resource-app

compute:
  web:
    kind: worker

resources:
  session-index:
    type: key-value
    bindings:
      missing: SESSION_INDEX

routes:
  - target: web
    path: /
`),
    Error,
    "resources.session-index.bindings references unknown compute: missing",
  );
});

test("public source contract - rejects dockerfile-only attached containers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-dockerfile-only-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        dockerfile: ./containers//sandbox.Dockerfile
        port: 3000

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.containers.sandbox.dockerfile may only be used as metadata with a digest-pinned image",
  );
});

test("public source contract - rejects dockerfile-only services", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: service-dockerfile-only-app

compute:
  api:
    dockerfile: ./services/api.Dockerfile
    port: 8080

routes:
  - target: api
    path: /
`),
    Error,
    "compute.api.dockerfile may only be used as metadata with a digest-pinned image",
  );
});

test("public source contract - requires port on image-backed compute", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: service-port-app

compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

routes:
  - target: api
    path: /
`),
    Error,
    "compute.api.port is required for service compute",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-port-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.containers.sandbox.port is required for attached container compute",
  );
});

test("public source contract - rejects volumes on workers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: worker-volume-app

compute:
  web:
    kind: worker
    volumes:
      cache:
        source: cache
        target: /cache

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.volumes is not supported for worker compute",
  );
});

test("public source contract - rejects build under attached containers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-build-app

compute:
  web:
    kind: worker
    containers:
      sandbox:
        build: {}
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.containers.sandbox.build is not supported for attached container compute",
  );
});

test("public source contract - rejects retired route and title publication aliases", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: retired-route-output-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /mcp
  - target: web
    path: /assets/:id

publish:
  - type: com.example.McpEndpoint
    name: notes
    publisher: web
    outputs:
      url:
        route: /mcp
    spec:
      protocol: streamable-http
`),
    Error,
    "publish[0].outputs.url.route is not supported by the publish/consume contract",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: retired-title-app

compute:
  web:
    kind: worker

routes:
  - id: mcp
    target: web
    path: /mcp

publish:
  - type: com.example.McpEndpoint
    name: notes
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: mcp
    title: Notes MCP
    spec:
      protocol: streamable-http
`),
    Error,
    "publish[0].title is not supported by the publish/consume contract",
  );
});

test("public source contract - preserves interface.ui.surface launcher metadata", () => {
  const manifest = parseAppManifestYaml(`
name: launcher-app

compute:
  web:
    kind: worker

routes:
  - target: web
    path: /

publish:
  - type: interface.ui.surface
    name: launcher
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: launcher
    display:
      title: Launcher
      description: Launcher app
      icon: /icons/launcher.svg
      category: office
      sortOrder: 10
    spec:
      launcher: true
`);

  assertEquals(manifest.publish[0]?.type, "interface.ui.surface");
  assertEquals(manifest.publish[0]?.display, {
    title: "Launcher",
    description: "Launcher app",
    icon: "/icons/launcher.svg",
    category: "office",
    sortOrder: 10,
  });
  assertEquals(manifest.publish[0]?.spec, {
    launcher: true,
  });
});

test("public source contract - preserves compute publisher image icon metadata", () => {
  const manifest = parseAppManifestYaml(`
name: publisher-icon-app

compute:
  web:
    icon: /icons/search.png
    kind: worker

routes:
  - id: launcher
    target: web
    path: /

publish:
  - type: interface.ui.surface
    name: launcher
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: launcher
`);

  assertEquals(manifest.compute.web?.icon, "/icons/search.png");
});

test("public source contract - parses interface.file.handler publications with route refs and selector lists", () => {
  const manifest = parseAppManifestYaml(`
name: file-handler-app

compute:
  web:
    kind: worker

routes:
  - id: file-open
    target: web
    path: /files/:id

publish:
  - type: interface.file.handler
    name: markdown
    publisher: web
    display:
      title: Markdown
    outputs:
      url:
        kind: url
        routeRef: file-open
    spec:
      mimeTypes:
        - text/markdown
`);

  assertEquals(manifest.publish[0]?.type, "interface.file.handler");
  assertEquals(manifest.publish[0]?.display, { title: "Markdown" });
  assertEquals(manifest.publish[0]?.outputs?.url?.routeRef, "file-open");
  assertEquals(manifest.publish[0]?.spec, {
    mimeTypes: ["text/markdown"],
  });
});

test("public source contract - rejects duplicate route publication publisher/route", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: duplicate-route-publication-app

compute:
  web:
    kind: worker

routes:
  - id: mcp
    target: web
    path: /mcp

publish:
  - type: com.example.McpEndpoint
    name: notes
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: mcp
  - type: com.example.SearchEndpoint
    name: search
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: mcp
`),
    Error,
    "duplicate route publication publisher/route 'web mcp'",
  );
});

test("public source contract - keeps route refs stable when overrides are applied", () => {
  const manifest = parseAppManifestYaml(`
name: overridden-route-publication-app

compute:
  web:
    kind: worker

routes:
  - id: base
    target: web
    path: /base

publish:
  - type: com.example.McpEndpoint
    name: tools
    publisher: web
    outputs:
      url:
        kind: url
        routeRef: base

overrides:
  production:
    routes:
      - id: base
        target: web
        path: /production
`);

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(resolved.routes, [
    {
      id: "base",
      target: "web",
      path: "/production",
    },
  ]);
  assertEquals(resolved.publish[0]?.outputs?.url?.routeRef, "base");
});

test("public source contract - rejects retired FileHandler route output aliases", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: file-handler-retired-route-app

compute:
  web:
    kind: worker

routes:
  - id: file-open
    target: web
    path: /files/open

publish:
  - type: interface.file.handler
    name: markdown
    publisher: web
    display:
      title: Markdown
    outputs:
      url:
        route: /files/open
    spec:
      mimeTypes:
        - text/markdown
`),
    Error,
    "publish[0].outputs.url.route is not supported by the publish/consume contract",
  );
});

test("public source contract - rejects interface.file.handler publications without mimeTypes or extensions", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: file-handler-missing-selectors-app

compute:
  web:
    kind: worker

routes:
  - id: file-open
    target: web
    path: /files/:id

publish:
  - type: interface.file.handler
    name: markdown
    publisher: web
    display:
      title: Markdown
    outputs:
      url:
        kind: url
        routeRef: file-open
    spec:
      note: no selectors
`),
    Error,
    "publish[0].spec.mimeTypes or publish[0].spec.extensions is required for interface.file.handler",
  );
});

test("public source contract - rejects unknown interface.file.handler spec fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: file-handler-extra-spec-app

compute:
  web:
    kind: worker

routes:
  - id: file-open
    target: web
    path: /files/:id

publish:
  - type: interface.file.handler
    name: markdown
    publisher: web
    display:
      title: Markdown
    outputs:
      url:
        kind: url
        routeRef: file-open
    spec:
      mimeTypes:
        - text/markdown
      note: no extra keys
`),
    Error,
    "publish[0].spec.note is not supported by the publish/consume contract",
  );
});

test("public source contract - rejects reserved Takos consumes", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-takos-api-consume-app

compute:
  web:
    kind: worker
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
`),
    Error,
    "compute.web.consume[0].publication 'takos.api-key' is not supported",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-oauth-client-consume-app

compute:
  web:
    kind: worker
    consume:
      - publication: takos.oauth-client
        as: app-oauth
        request:
          redirectUris:
            - /api/auth/callback
          scopes:
            - openid
`),
    Error,
    "compute.web.consume[0].publication 'takos.oauth-client' is not supported",
  );
});

test("public source contract - allows Takos workspace storage consume", () => {
  const manifest = parseAppManifestYaml(`
name: takos-storage-consume-app

compute:
  web:
    kind: worker
    consume:
      - publication: takos.storage.workspace
        request:
          scopes:
            - files:read
            - files:write
        inject:
          env:
            url: TAKOS_STORAGE_API_URL
`);

  assertEquals(manifest.compute.web?.consume?.[0], {
    publication: "takos.storage.workspace",
    request: {
      scopes: ["files:read", "files:write"],
    },
    inject: {
      env: {
        url: "TAKOS_STORAGE_API_URL",
      },
    },
  });
});

test("public source contract - parses inject env and rejects retired consume env aliases", () => {
  const manifest = parseAppManifestYaml(`
name: consume-inject-env-app

compute:
  web:
    kind: worker
    consume:
      - publication: external-api
        inject:
          env:
            endpoint: external_api_url
`);

  assertEquals(manifest.compute.web.consume, [
    {
      publication: "external-api",
      inject: { env: { endpoint: "EXTERNAL_API_URL" } },
    },
  ]);

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: retired-consume-env-alias-app

compute:
  web:
    kind: worker
    consume:
      - publication: external-api
        env:
          endpoint: EXTERNAL_API_URL
`),
    Error,
    "compute.web.consume[0].env is not supported by the Capsule desired-state projection contract",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-consume-inject-env-app

compute:
  web:
    kind: worker
    consume:
      - publication: external-api
        inject:
          env:
            endpoint: bad-env-name
`),
    Error,
    "compute.web.consume[0].inject.env.endpoint has invalid env name: bad-env-name",
  );
});

test("public source contract - rejects unsupported top-level manifest fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
apiVersion: example.com/v1
metadata:
  name: unsupported-top-level-fields-app
spec:
  compute: {}
`),
    Error,
    "Takos desired-state projections use the flat contract",
  );
});

test("public source contract - rejects unsupported top-level scopes and oauth", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-top-level-fields-app
scopes:
  - files:read
compute:
  web:
    kind: worker
`),
    Error,
    "scopes is not supported by the Capsule desired-state projection contract",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-top-level-fields-app
oauth:
  redirectUris:
    - https://example.com/callback
  scopes:
    - threads:read
compute:
  web:
    kind: worker
`),
    Error,
    "oauth is not supported by the Capsule desired-state projection contract",
  );
});

test("public source contract - rejects unsupported storage", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-top-level-fields-app
storage:
  db:
    type: sql
compute:
  web:
    kind: worker
`),
    Error,
    "storage is not supported by the Capsule desired-state projection contract",
  );
});

test("public source contract - rejects platform credential fields outside spec", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-publish-field-app
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    scopes:
      - files:read
compute:
  web:
    kind: worker
`),
    Error,
    "publish[0].scopes is not supported by the publish/consume contract",
  );
});

test("public source contract - rejects Takos-owned publication names", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: reserved-takos-publication-name-app
publish:
  - name: takos.storage.workspace
    publisher: web
    type: storage.filesystem
    outputs:
      url:
        kind: url
        routeRef: storage
compute:
  web:
    kind: worker
routes:
  - id: storage
    target: web
    path: /storage
`),
    Error,
    "publish[0].name 'takos.storage.workspace' is reserved for Takos runtime services",
  );
});

test("public source contract - rejects unsupported Takos publication field", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-takos-publication-field-app
publish:
  - name: takos-api
    catalog: takos
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read
compute:
  web:
    kind: worker
`),
    Error,
    "publish[0].catalog is not supported by the publish/consume contract",
  );
});

test("public source contract - rejects reserved Takos publications", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: resource-publish-app
publish:
  - name: primary-db
    publisher: takos
    type: resource
    spec:
      resource: notes-db
compute:
  web:
    kind: worker
`),
    Error,
    "publish[0].publisher 'takos' is not supported in Capsule desired-state projections",
  );
});

test("public source contract - rejects legacy route fields and Takos publication fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: takos-grant-route-field-app
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    path: /mcp
    spec:
      scopes:
        - files:read
compute:
  web:
    kind: worker
`),
    Error,
    "publish[0].path is not supported by the publish/consume contract",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: takos-grant-title-field-app
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    display:
      title: Takos API
    spec:
      scopes:
        - files:read
compute:
  web:
    kind: worker
`),
    Error,
    "publish[0].publisher 'takos' is not supported in Capsule desired-state projections",
  );
});

test("public source contract - rejects unsupported compute capabilities", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-compute-capabilities-app
compute:
  web:
    kind: worker
    capabilities:
      takosApi:
        scopes:
          - files:read
`),
    Error,
    "compute.web.capabilities is not supported by the Capsule desired-state projection contract",
  );
});

test("public source contract - accepts queue consumer triggers", () => {
  const manifest = parseAppManifestYaml(`
name: queue-trigger-app
compute:
  worker:
    kind: worker
    triggers:
      queues:
        - binding: jobs
          deadLetterQueue: JOBS_DLQ
          maxBatchSize: 10
          maxConcurrency: 2
          maxRetries: 3
          maxWaitTimeMs: 5000
          retryDelaySeconds: 10
`);

  assertEquals(manifest.compute.worker.triggers?.queues, [
    {
      binding: "JOBS",
      deadLetterQueue: "JOBS_DLQ",
      maxBatchSize: 10,
      maxConcurrency: 2,
      maxRetries: 3,
      maxWaitTimeMs: 5000,
      retryDelaySeconds: 10,
    },
  ]);
});

test("public source contract - rejects queue triggers without binding or queue", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: invalid-queue-trigger-app
compute:
  worker:
    kind: worker
    triggers:
      queues:
        - maxBatchSize: 10
`),
    Error,
    "compute.worker.triggers.queues[0] requires binding or queue",
  );
});

test("public source contract - parses contractVersion, service bindings, and bearer auth", () => {
  const manifest = parseAppManifestYaml(`
contractVersion: 1
name: service-grant-app
version: 1.0.0

compute:
  web:
    kind: worker

routes:
  - id: mcp
    target: web
    path: /mcp

publish:
  - name: tools
    publisher: web
    type: protocol.mcp.server
    outputs:
      url:
        kind: url
        routeRef: mcp
    auth:
      kind: bearer
      secretRef: mcp_token

serviceBindings:
  - name: space-control
    capability: control.api
    target: web
    inject:
      baseUrlEnv: takosumi_control_url
      tokenEnv: takosumi_control_token
    scopes:
      - installations.outputs.read.same-space
`);

  assertEquals(manifest.contractVersion, 1);
  assertEquals(manifest.publish[0]?.auth, {
    kind: "bearer",
    secretRef: "mcp_token",
  });
  assertEquals(manifest.serviceBindings, [
    {
      name: "space-control",
      capability: "control.api",
      target: "web",
      inject: {
        baseUrlEnv: "TAKOSUMI_CONTROL_URL",
        tokenEnv: "TAKOSUMI_CONTROL_TOKEN",
      },
      scopes: ["installations.outputs.read.same-space"],
    },
  ]);
});

test("public source contract - rejects schema and unsupported contractVersion", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
schema: https://takos.jp/schemas/app/v1
name: schema-app
compute:
  web:
    kind: worker
`),
    Error,
    "schema is not supported; use contractVersion = 1",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
contractVersion: 2
name: future-contract-app
compute:
  web:
    kind: worker
`),
    Error,
    "contractVersion must be the number 1",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
contractVersion: "1"
name: string-contract-app
compute:
  web:
    kind: worker
`),
    Error,
    "contractVersion must be the number 1",
  );
});

test("public source contract - rejects invalid service binding grants", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unknown-service-binding-target-app
compute:
  web:
    kind: worker
serviceBindings:
  - name: space-control
    capability: control.api
    target: api
    inject:
      baseUrlEnv: TAKOSUMI_CONTROL_URL
      tokenEnv: TAKOSUMI_CONTROL_TOKEN
    scopes:
      - installations.outputs.read.same-space
`),
    Error,
    "serviceBindings[0].target references unknown top-level compute: api",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: duplicate-service-binding-env-app
compute:
  web:
    kind: worker
serviceBindings:
  - name: space-control
    capability: control.api
    target: web
    inject:
      baseUrlEnv: TAKOSUMI_CONTROL_URL
      tokenEnv: TAKOSUMI_CONTROL_TOKEN
    scopes:
      - installations.outputs.read.same-space
  - name: space-control-reader
    capability: control.api
    target: web
    inject:
      baseUrlEnv: TAKOSUMI_CONTROL_READER_URL
      tokenEnv: TAKOSUMI_CONTROL_TOKEN
    scopes:
      - installations.outputs.read.same-space
`),
    Error,
    "serviceBindings[1].inject env 'TAKOSUMI_CONTROL_TOKEN' duplicates service binding 'space-control' for compute 'web'",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-service-binding-app
compute:
  web:
    kind: worker
serviceBindings:
  - name: memory
    capability: takos.memory.workspace
    target: web
    inject:
      baseUrlEnv: TAKOS_MEMORY_URL
      tokenEnv: TAKOS_MEMORY_TOKEN
    scopes:
      - memory.read
`),
    Error,
    "serviceBindings[0].capability 'takos.memory.workspace' is not supported by the Takos runtime projection profile",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: service-binding-missing-token-env-app
compute:
  web:
    kind: worker
serviceBindings:
  - name: space-control
    capability: control.api
    target: web
    inject:
      baseUrlEnv: TAKOSUMI_CONTROL_URL
    scopes:
      - installations.outputs.read.same-space
`),
    Error,
    "serviceBindings[0].inject.baseUrlEnv and serviceBindings[0].inject.tokenEnv are required",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: service-binding-missing-scopes-app
compute:
  web:
    kind: worker
serviceBindings:
  - name: space-control
    capability: control.api
    target: web
    inject:
      baseUrlEnv: TAKOSUMI_CONTROL_URL
      tokenEnv: TAKOSUMI_CONTROL_TOKEN
`),
    Error,
    "serviceBindings[0].scopes must declare at least one scope",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: service-binding-unsupported-scope-app
compute:
  web:
    kind: worker
serviceBindings:
  - name: space-control
    capability: control.api
    target: web
    inject:
      baseUrlEnv: TAKOSUMI_CONTROL_URL
      tokenEnv: TAKOSUMI_CONTROL_TOKEN
    scopes:
      - provider.credentials.manage
`),
    Error,
    "serviceBindings[0].scopes[0] 'provider.credentials.manage' is not supported by service binding capability 'control.api'",
  );
});

test("public source contract - rejects inconsistent publication auth", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: oidc-secret-app
compute:
  web:
    kind: worker
publish:
  - name: tools
    publisher: web
    type: protocol.mcp.server
    outputs:
      url:
        kind: url
        routeRef: mcp
    auth:
      kind: takos_oidc
      secretRef: MCP_TOKEN
`),
    Error,
    "publish[0].auth.secretRef is only supported when auth.kind is bearer",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: missing-auth-kind-app
compute:
  web:
    kind: worker
publish:
  - name: tools
    publisher: web
    type: protocol.mcp.server
    outputs:
      url:
        kind: url
        routeRef: mcp
    auth:
      secretRef: MCP_TOKEN
`),
    Error,
    "publish[0].auth.kind is required when auth.secretRef is set",
  );
});
