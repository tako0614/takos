import { assertEquals, assertThrows } from "jsr:@std/assert";
import { applyManifestOverrides } from "../../deployment/group-state.ts";
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

Deno.test("public manifest contract - treats build artifactPath as optional metadata", () => {
  const manifest = parseAppManifestYaml(`
name: artifact-path-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: ./dist//worker

routes:
  - target: web
    path: /
`);

  assertEquals(
    manifest.compute.web.build?.fromWorkflow.artifactPath,
    "dist/worker",
  );

  const missingArtifactPath = parseAppManifestYaml(`
name: missing-artifact-path-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web

routes:
  - target: web
    path: /
`);

  assertEquals(
    missingArtifactPath.compute.web.build?.fromWorkflow.artifactPath,
    undefined,
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: escaping-artifact-path-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: ../dist/worker

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.build.fromWorkflow.artifactPath must not contain path traversal",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: escaping-workflow-path-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/../deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.build.fromWorkflow.path must not contain path traversal",
  );
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
  - type: com.example.McpEndpoint
    name: notes
    publisher: web
    outputs:
      url:
        route: /mcp
    spec:
      protocol: streamable-http
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
  assertEquals(manifest.publish[0]?.publisher, "web");
  assertEquals(manifest.publish[0]?.outputs, { url: { route: "/mcp" } });
  assertEquals(manifest.publish[0]?.spec, { protocol: "streamable-http" });
});

Deno.test("public manifest contract - rejects routes targeting attached containers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-route-app

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

routes:
  - target: sandbox
    path: /sandbox
`),
    Error,
    "routes[0].target references attached container compute",
  );
});

Deno.test("public manifest contract - rejects duplicate route target/path entries during parse", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: duplicate-route-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
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

Deno.test("public manifest contract - rejects overlapping route paths during parse", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: overlapping-route-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: api
        artifactPath: dist/api

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

Deno.test("public manifest contract - rejects Takos publications in app manifests during parse", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
`),
    Error,
    "publish[0].publisher 'takos' is not supported in app manifests",
  );
});

Deno.test("public manifest contract - rejects invalid route timeoutMs", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-route-timeout-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /
    timeoutMs: 0
`),
    Error,
    "routes[0].timeoutMs must be >= 1",
  );
});

Deno.test("public manifest contract - uppercases route methods during parse", () => {
  const manifest = parseAppManifestYaml(`
name: method-normalization-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /api
    methods:
      - get
      - post
`);

  assertEquals(manifest.routes[0]?.methods, ["GET", "POST"]);
});

Deno.test("public manifest contract - rejects unsupported legacy route fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-route-fields-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - name: route-name
    target: web
    path: /
`),
    Error,
    "routes[0].name is not supported by the app manifest contract",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-route-fields-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - ingress: public
    target: web
    path: /
`),
    Error,
    "routes[0].ingress is not supported by the app manifest contract",
  );
});

Deno.test("public manifest contract - defers override route target validation to apply time", () => {
  const manifest = parseAppManifestYaml(`
name: override-route-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /

overrides:
  staging:
    routes:
      - target: api
        path: /api
`);

  assertEquals(manifest.overrides?.staging?.routes, [{
    target: "api",
    path: "/api",
  }]);

  assertThrows(
    () => applyManifestOverrides(manifest, "staging"),
    Error,
    "routes[0].target references unknown compute: api",
  );
});

Deno.test("public manifest contract - accepts partial compute overrides and deep merges them at apply time", () => {
  const manifest = parseAppManifestYaml(`
name: override-compute-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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
  assertEquals(
    resolved.compute.web.build?.fromWorkflow.artifactPath,
    "dist/worker",
  );
  assertEquals(resolved.compute.web.scaling, { minInstances: 2 });
});

Deno.test("public manifest contract - accepts queue trigger overrides", () => {
  const manifest = parseAppManifestYaml(`
name: override-queue-trigger-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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
  assertEquals(resolved.compute.web.triggers?.queues, [{
    binding: "DELIVERY_QUEUE",
    deadLetterQueue: "DELIVERY_DLQ",
    maxBatchSize: 10,
    maxRetries: 3,
  }]);
});

Deno.test("public manifest contract - validates compute overrides after merge", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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

Deno.test("public manifest contract - accepts partial publish overrides", () => {
  const manifest = parseAppManifestYaml(`
name: override-publish-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /mcp

publish:
  - name: notes
    type: com.example.McpEndpoint
    publisher: web
    outputs:
      url:
        route: /mcp
    spec:
      protocol: streamable-http

overrides:
  production:
    publish:
      - title: Production Notes
`);

  assertEquals(manifest.overrides?.production?.publish as unknown, [{
    title: "Production Notes",
  }]);

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(resolved.publish, [{
    name: "notes",
    type: "com.example.McpEndpoint",
    publisher: "web",
    outputs: { url: { route: "/mcp" } },
    spec: { protocol: "streamable-http" },
    title: "Production Notes",
  }]);
});

Deno.test("public manifest contract - merges named publish overrides", () => {
  const manifest = parseAppManifestYaml(`
name: named-publish-override-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /mcp
  - target: web
    path: /assets

publish:
  - name: notes
    type: com.example.McpEndpoint
    publisher: web
    outputs:
      url:
        route: /mcp
    spec:
      protocol: streamable-http
  - name: assets
    type: com.example.FileEndpoint
    publisher: web
    outputs:
      url:
        route: /assets
    spec:
      contentTypes:
        - image/png

overrides:
  production:
    publish:
      - name: assets
        title: Production Assets
`);

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(resolved.publish, [
    {
      name: "notes",
      type: "com.example.McpEndpoint",
      publisher: "web",
      outputs: { url: { route: "/mcp" } },
      spec: { protocol: "streamable-http" },
    },
    {
      name: "assets",
      type: "com.example.FileEndpoint",
      publisher: "web",
      outputs: { url: { route: "/assets" } },
      spec: { contentTypes: ["image/png"] },
      title: "Production Assets",
    },
  ]);
});

Deno.test("public manifest contract - rejects unsupported fields in overrides", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: override-unsupported-field-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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

Deno.test("public manifest contract - rejects readiness on non-worker compute", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
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

Deno.test("public manifest contract - requires digest-pinned image refs", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
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

Deno.test("public manifest contract - rejects non-portable compute tuning fields", () => {
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
    "compute.api.instanceType is not supported by the app manifest contract",
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
    "compute.api.scaling.cpu is not supported by the app manifest contract",
  );
});

Deno.test("public manifest contract - allows image-backed attached containers with dockerfile metadata", () => {
  const manifest = parseAppManifestYaml(`
name: attached-image-dockerfile-app

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

Deno.test("public manifest contract - allows native Cloudflare container metadata", () => {
  const manifest = parseAppManifestYaml(`
name: native-cloudflare-container-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker.js
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

Deno.test("public manifest contract - rejects quoted Cloudflare container booleans", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: native-cloudflare-container-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker.js
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

Deno.test("public manifest contract - parses managed resources and bindings", () => {
  const manifest = parseAppManifestYaml(`
name: resource-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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

  assertEquals(manifest.resources?.["session-index"].bindings, [{
    target: "web",
    binding: "SESSION_INDEX",
  }]);
  assertEquals(manifest.resources?.["host-token"].bindings, [{
    target: "web",
    binding: "SANDBOX_HOST_AUTH_TOKEN",
  }]);
});

Deno.test("public manifest contract - rejects quoted resource generate booleans", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-resource-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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

Deno.test("public manifest contract - rejects resource bindings to unknown compute", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-resource-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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

Deno.test("public manifest contract - rejects dockerfile-only attached containers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-dockerfile-only-app

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

Deno.test("public manifest contract - rejects dockerfile-only services", () => {
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

Deno.test("public manifest contract - requires port on image-backed compute", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
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

Deno.test("public manifest contract - rejects volumes on workers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: worker-volume-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
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

Deno.test("public manifest contract - rejects build under attached containers", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: attached-build-app

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
        build:
          fromWorkflow:
            path: .takos/workflows/deploy.yml
            job: bundle
            artifact: sandbox
            artifactPath: dist/container
        image: ghcr.io/org/sandbox@sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210

routes:
  - target: web
    path: /
`),
    Error,
    "compute.web.containers.sandbox.build is not supported for attached container compute",
  );
});

Deno.test("public manifest contract - preserves route publication titles", () => {
  const manifest = parseAppManifestYaml(`
name: publication-title-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

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
    title: Notes MCP
    spec:
      protocol: streamable-http
  - type: com.example.FileEndpoint
    name: assets
    publisher: web
    outputs:
      url:
        route: /assets/:id
    title: Asset Browser
    spec:
      contentTypes:
        - image/png
`);

  assertEquals(manifest.publish[0]?.title, "Notes MCP");
  assertEquals(manifest.publish[1]?.title, "Asset Browser");
  assertEquals(manifest.publish[1]?.outputs?.url?.route, "/assets/:id");
});

Deno.test("public manifest contract - preserves UiSurface launcher metadata", () => {
  const manifest = parseAppManifestYaml(`
name: launcher-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /

publish:
  - type: UiSurface
    name: launcher
    publisher: web
    outputs:
      url:
        route: /
    title: Launcher
    spec:
      description: Launcher app
      icon: /icons/launcher.svg
      category: office
      sortOrder: 10
      launcher: true
`);

  assertEquals(manifest.publish[0]?.type, "UiSurface");
  assertEquals(manifest.publish[0]?.spec, {
    description: "Launcher app",
    icon: "/icons/launcher.svg",
    category: "office",
    sortOrder: 10,
    launcher: true,
  });
});

Deno.test("public manifest contract - preserves compute publisher image icon metadata", () => {
  const manifest = parseAppManifestYaml(`
name: publisher-icon-app

compute:
  web:
    icon: /icons/search.png
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /

publish:
  - type: UiSurface
    name: launcher
    publisher: web
    outputs:
      url:
        route: /
`);

  assertEquals(manifest.compute.web?.icon, "/icons/search.png");
});

Deno.test("public manifest contract - parses FileHandler publications with :id paths and selector lists", () => {
  const manifest = parseAppManifestYaml(`
name: file-handler-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /files/:id

publish:
  - type: FileHandler
    name: markdown
    publisher: web
    title: Markdown
    outputs:
      url:
        route: /files/:id
    spec:
      mimeTypes:
        - text/markdown
`);

  assertEquals(manifest.publish[0]?.type, "FileHandler");
  assertEquals(manifest.publish[0]?.outputs?.url?.route, "/files/:id");
  assertEquals(manifest.publish[0]?.spec, {
    mimeTypes: ["text/markdown"],
  });
});

Deno.test("public manifest contract - rejects duplicate route publication publisher/route", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: duplicate-route-publication-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /mcp

publish:
  - type: com.example.McpEndpoint
    name: notes
    publisher: web
    outputs:
      url:
        route: /mcp
  - type: com.example.SearchEndpoint
    name: search
    publisher: web
    outputs:
      url:
        route: /mcp
`),
    Error,
    "duplicate route publication publisher/route 'web /mcp'",
  );
});

Deno.test("public manifest contract - defers route publication matching until overrides are applied", () => {
  const manifest = parseAppManifestYaml(`
name: overridden-route-publication-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /base

publish:
  - type: com.example.McpEndpoint
    name: tools
    publisher: web
    outputs:
      url:
        route: /production

overrides:
  production:
    routes:
      - target: web
        path: /production
`);

  const resolved = applyManifestOverrides(manifest, "production");
  assertEquals(resolved.routes, [{ target: "web", path: "/production" }]);
  assertEquals(resolved.publish[0]?.outputs?.url?.route, "/production");
});

Deno.test("public manifest contract - rejects FileHandler publications without :id launch paths", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: file-handler-missing-id-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /files/open

publish:
  - type: FileHandler
    name: markdown
    publisher: web
    title: Markdown
    outputs:
      url:
        route: /files/open
    spec:
      mimeTypes:
        - text/markdown
`),
    Error,
    "publish[0].outputs must include a route with :id for FileHandler",
  );
});

Deno.test("public manifest contract - rejects FileHandler publications without mimeTypes or extensions", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: file-handler-missing-selectors-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /files/:id

publish:
  - type: FileHandler
    name: markdown
    publisher: web
    title: Markdown
    outputs:
      url:
        route: /files/:id
    spec:
      note: no selectors
`),
    Error,
    "publish[0].spec.mimeTypes or publish[0].spec.extensions is required for FileHandler",
  );
});

Deno.test("public manifest contract - rejects unknown FileHandler spec fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: file-handler-extra-spec-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
    path: /files/:id

publish:
  - type: FileHandler
    name: markdown
    publisher: web
    title: Markdown
    outputs:
      url:
        route: /files/:id
    spec:
      mimeTypes:
        - text/markdown
      note: no extra keys
`),
    Error,
    "publish[0].spec.note is not supported by the publish/consume contract",
  );
});

Deno.test("public manifest contract - parses Takos system publications as compute consume requests", () => {
  const manifest = parseAppManifestYaml(`
name: publication-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
      - publication: takos.oauth-client
        as: app-oauth
        request:
          clientName: Notes App
          redirectUris:
            - https://example.com/oauth/callback
          scopes:
            - threads:read
          metadata:
            logoUri: https://example.com/logo.png
`);

  assertEquals(manifest.publish, []);
  assertEquals(manifest.compute.web.consume, [
    {
      publication: "takos.api-key",
      as: "takos-api",
      request: { scopes: ["files:read"] },
    },
    {
      publication: "takos.oauth-client",
      as: "app-oauth",
      request: {
        clientName: "Notes App",
        redirectUris: ["https://example.com/oauth/callback"],
        scopes: ["threads:read"],
        metadata: {
          logoUri: "https://example.com/logo.png",
        },
      },
    },
  ]);
});

Deno.test("public manifest contract - allows relative OAuth redirect URIs", () => {
  const manifest = parseAppManifestYaml(`
name: relative-oauth-redirect-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos.oauth-client
        as: app-oauth
        request:
          redirectUris:
            - /api/auth/callback
          scopes:
            - openid
`);

  assertEquals(manifest.compute.web.consume?.[0], {
    publication: "takos.oauth-client",
    as: "app-oauth",
    request: {
      redirectUris: ["/api/auth/callback"],
      scopes: ["openid"],
    },
  });
});

Deno.test("public manifest contract - rejects malformed Takos system consume requests", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: takos-api-request-array-app
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          - scopes
`),
    Error,
    "compute.web.consume[0].request must be an object",
  );

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: takos-oauth-unsupported-consume-field-app
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos.oauth-client
        as: app-oauth
        spec:
          scopes:
            - threads:read
`),
    Error,
    "compute.web.consume[0].spec is not supported by the app manifest contract",
  );
});

Deno.test("public manifest contract - normalizes and validates consume env aliases", () => {
  const manifest = parseAppManifestYaml(`
name: consume-env-alias-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: external-api
        env:
          endpoint: external_api_url
`);

  assertEquals(manifest.compute.web.consume, [
    {
      publication: "external-api",
      env: { endpoint: "EXTERNAL_API_URL" },
    },
  ]);

  assertThrows(
    () =>
      parseAppManifestYaml(`
name: bad-consume-env-alias-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: external-api
        env:
          endpoint: bad-env-name
`),
    Error,
    "compute.web.consume[0].env.endpoint has invalid env name: bad-env-name",
  );
});

Deno.test("public manifest contract - rejects unsupported top-level manifest fields", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
apiVersion: example.com/v1
kind: App
metadata:
  name: unsupported-top-level-fields-app
spec:
  compute: {}
`),
    Error,
    "Takos app manifests use the flat contract",
  );
});

Deno.test("public manifest contract - rejects unsupported top-level scopes and oauth", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-top-level-fields-app
scopes:
  - files:read
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
`),
    Error,
    "scopes is not supported by the app manifest contract",
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
`),
    Error,
    "oauth is not supported by the app manifest contract",
  );
});

Deno.test("public manifest contract - rejects unsupported storage", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-top-level-fields-app
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
        artifactPath: dist/worker
`),
    Error,
    "storage is not supported by the app manifest contract",
  );
});

Deno.test("public manifest contract - rejects grant fields outside spec", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
`),
    Error,
    "publish[0].scopes is not supported by the publish/consume contract",
  );
});

Deno.test("public manifest contract - rejects unsupported Takos grant field", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
`),
    Error,
    "publish[0].catalog is not supported by the publish/consume contract",
  );
});

Deno.test("public manifest contract - rejects Takos platform publications", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
`),
    Error,
    "publish[0].publisher 'takos' is not supported in app manifests",
  );
});

Deno.test("public manifest contract - rejects legacy route fields and Takos publication fields", () => {
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
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
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
    title: Takos API
    spec:
      scopes:
        - files:read
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
`),
    Error,
    "publish[0].publisher 'takos' is not supported in app manifests",
  );
});

Deno.test("public manifest contract - rejects unsupported compute capabilities", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: unsupported-compute-capabilities-app
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    capabilities:
      takosApi:
        scopes:
          - files:read
`),
    Error,
    "compute.web.capabilities is not supported by the app manifest contract",
  );
});

Deno.test("public manifest contract - accepts queue consumer triggers", () => {
  const manifest = parseAppManifestYaml(`
name: queue-trigger-app
compute:
  worker:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
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

  assertEquals(manifest.compute.worker.triggers?.queues, [{
    binding: "JOBS",
    deadLetterQueue: "JOBS_DLQ",
    maxBatchSize: 10,
    maxConcurrency: 2,
    maxRetries: 3,
    maxWaitTimeMs: 5000,
    retryDelaySeconds: 10,
  }]);
});

Deno.test("public manifest contract - rejects queue triggers without binding or queue", () => {
  assertThrows(
    () =>
      parseAppManifestYaml(`
name: invalid-queue-trigger-app
compute:
  worker:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    triggers:
      queues:
        - maxBatchSize: 10
`),
    Error,
    "compute.worker.triggers.queues[0] requires binding or queue",
  );
});
