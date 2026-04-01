import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assert,
  assertEquals,
  assertObjectMatch,
  assertRejects,
} from "jsr:@std/assert";
import {
  loadAppManifest,
  validateAppManifest,
} from "../src/lib/app-manifest.ts";

const tempDirs: string[] = [];

async function createTempRepo(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "takos-app-manifest-"));
  tempDirs.push(dir);

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const fullPath = path.join(dir, relativePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf8");
    }),
  );

  return dir;
}

async function cleanupTempRepos() {
  await Promise.all(
    tempDirs.splice(0).map((dir) =>
      fs.rm(dir, { recursive: true, force: true })
    ),
  );
}

Deno.test("app manifest - loads workers manifest", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: sample-app
  appId: dev.takos.sample-app
spec:
  version: 1.0.0
  description: Sample app
  resources:
    main-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/main-db/up
        down: .takos/migrations/main-db/down
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
      bindings:
        d1: [main-db]
  routes:
    - name: gateway-root
      target: gateway
      path: /
  mcpServers:
    - name: gateway-mcp
      route: gateway-root
`,
    });

    const manifest = await loadAppManifest(
      path.join(repoDir, ".takos/app.yml"),
    );
    const workers = manifest.spec.workers;
    const routes = manifest.spec.routes;
    const mcpServers = manifest.spec.mcpServers;

    assert(workers);
    assert(routes);
    assert(mcpServers);

    assertEquals(manifest.metadata.name, "sample-app");
    assert(workers.gateway);
    assertEquals(workers.gateway.build?.fromWorkflow, {
      path: ".takos/workflows/build.yml",
      job: "build-gateway",
      artifact: "gateway-dist",
      artifactPath: "dist/gateway.mjs",
    });
    assertEquals(routes.length, 1);
    assertEquals(mcpServers.length, 1);
  } finally {
    await cleanupTempRepos();
  }
});

Deno.test("app manifest - preserves the extended manifest surface", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: rich-app
spec:
  version: 2.1.0
  description: Rich manifest
  env:
    required: [API_KEY]
    inject:
      API_URL: "{{routes.api.url}}"
      BROWSER_PORT: "{{containers.browser.port}}"
      SEARCH_INDEX_ID: "{{resources.searchIndex.id}}"
  resources:
    main-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/main-db/up
        down: .takos/migrations/main-db/down
    searchIndex:
      type: vectorize
      binding: SEARCH_INDEX
      vectorize:
        dimensions: 1536
        metric: cosine
    jobQueue:
      type: queue
      binding: JOB_QUEUE
      queue:
        maxRetries: 5
    analytics:
      type: analyticsEngine
      binding: ANALYTICS
      analyticsEngine:
        dataset: app_analytics
    workflowDispatch:
      type: workflow
      binding: WORKFLOW_DISPATCH
      workflow:
        service: api
        export: dispatch
        timeoutMs: 30000
        maxRetries: 2
    browserSessions:
      type: durableObject
      binding: BROWSER_SESSIONS
      durableObject:
        className: BrowserSessions
        scriptName: browser
    oauthSecret:
      type: secretRef
      binding: OAUTH_CLIENT_SECRET
  containers:
    browser:
      dockerfile: packages/browser/Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 3
      env:
        CHROME_FLAGS: --headless=new
      volumes:
        - name: browser-cache
          mountPath: /cache
          size: 1Gi
  services:
    browserApi:
      dockerfile: services/browser-api/Dockerfile
      port: 3000
      ipv4: true
      env:
        API_BASE: https://example.com
      healthCheck:
        type: http
        path: /health
      bindings:
        services:
          - name: api
            version: ^1.0.0
      triggers:
        schedules:
          - cron: "*/5 * * * *"
            export: sync
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-worker
          artifactPath: dist/index.js
      containers: [browser]
      env:
        API_MODE: production
      bindings:
        d1: [main-db]
        vectorize: [searchIndex]
        queues: [jobQueue]
        analyticsEngine: [analytics]
        workflow: [workflowDispatch]
        durableObjects: [browserSessions]
        services:
          - browserApi
      triggers:
        schedules:
          - cron: 0 * * * *
            export: cron
        queues:
          - queue: jobQueue
            export: handleJob
      healthCheck:
        type: tcp
        port: 8080
      scaling:
        minInstances: 1
        maxConcurrency: 10
      dependsOn: [browserApi]
  routes:
    - name: api
      target: api
      path: /api
      ingress: api
      methods: [GET, POST]
    - name: browser
      target: browser
      path: /browser
    - name: browserApi
      target: browserApi
      path: /browser-api
  mcpServers:
    - name: browser-mcp
      route: browserApi
      authSecretRef: oauthSecret
      transport: streamable-http
  overrides:
    staging:
      containers:
        browser:
          env:
            CHROME_FLAGS: --disable-dev-shm-usage
      workers:
        api:
          env:
            API_MODE: staging
      services:
        browserApi:
          env:
            API_BASE: https://staging.example.com
`,
      ".takos/workflows/build.yml": `
jobs:
  build-api:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
`,
      ".takos/migrations/main-db/up": "create table test(id text);",
      ".takos/migrations/main-db/down": "drop table test;",
    });

    const manifest = await loadAppManifest(
      path.join(repoDir, ".takos/app.yml"),
    );
    const containers = manifest.spec.containers;
    const services = manifest.spec.services;
    const workers = manifest.spec.workers;
    const routes = manifest.spec.routes;
    const mcpServers = manifest.spec.mcpServers;
    const env = manifest.spec.env;
    const overrides = manifest.spec.overrides;

    assert(containers);
    assert(services);
    assert(workers);
    assert(routes);
    assert(mcpServers);
    assert(env);
    assert(overrides);

    assertObjectMatch(containers.browser, {
      dockerfile: "packages/browser/Dockerfile",
      port: 8080,
      instanceType: "standard-2",
      maxInstances: 3,
      env: { CHROME_FLAGS: "--headless=new" },
      volumes: [{ name: "browser-cache", mountPath: "/cache", size: "1Gi" }],
    });
    assertObjectMatch(services.browserApi, {
      dockerfile: "services/browser-api/Dockerfile",
      port: 3000,
      ipv4: true,
      env: { API_BASE: "https://example.com" },
      healthCheck: { type: "http", path: "/health" },
      bindings: { services: [{ name: "api", version: "^1.0.0" }] },
      triggers: { schedules: [{ cron: "*/5 * * * *", export: "sync" }] },
    });
    assertObjectMatch(workers.api, {
      containers: ["browser"],
      env: { API_MODE: "production" },
      bindings: {
        d1: ["main-db"],
        vectorize: ["searchIndex"],
        queues: ["jobQueue"],
        analyticsEngine: ["analytics"],
        workflow: ["workflowDispatch"],
        durableObjects: ["browserSessions"],
        services: ["browserApi"],
      },
      triggers: {
        schedules: [{ cron: "0 * * * *", export: "cron" }],
        queues: [{ queue: "jobQueue", export: "handleJob" }],
      },
      healthCheck: { type: "tcp", port: 8080 },
      scaling: { minInstances: 1, maxConcurrency: 10 },
      dependsOn: ["browserApi"],
    });
    assertEquals(routes, [
      {
        name: "api",
        target: "api",
        path: "/api",
        ingress: "api",
        methods: ["GET", "POST"],
      },
      { name: "browser", target: "browser", path: "/browser" },
      { name: "browserApi", target: "browserApi", path: "/browser-api" },
    ]);
    assertEquals(env, {
      required: ["API_KEY"],
      inject: {
        API_URL: "{{routes.api.url}}",
        BROWSER_PORT: "{{containers.browser.port}}",
        SEARCH_INDEX_ID: "{{resources.searchIndex.id}}",
      },
    });
    assertEquals(mcpServers, [
      {
        name: "browser-mcp",
        route: "browserApi",
        authSecretRef: "oauthSecret",
        transport: "streamable-http",
      },
    ]);
    assertEquals(overrides, {
      staging: {
        containers: {
          browser: {
            env: { CHROME_FLAGS: "--disable-dev-shm-usage" },
          },
        },
        workers: {
          api: {
            env: { API_MODE: "staging" },
          },
        },
        services: {
          browserApi: {
            env: { API_BASE: "https://staging.example.com" },
          },
        },
      },
    });
  } finally {
    await cleanupTempRepos();
  }
});

Deno.test("app manifest - rejects workers without fromWorkflow build source", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-worker
spec:
  version: 1.0.0
  workers:
    gateway:
      build: {}
`,
    });

    await assertRejects(
      () => loadAppManifest(path.join(repoDir, ".takos/app.yml")),
      Error,
      "build.fromWorkflow or artifact.kind=bundle",
    );
  } finally {
    await cleanupTempRepos();
  }
});

Deno.test("app manifest - rejects missing workflow files during validation", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: missing-workflow
spec:
  version: 1.0.0
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
`,
    });

    await assertRejects(
      () => validateAppManifest(repoDir),
      Error,
      "Workflow file not found",
    );
  } finally {
    await cleanupTempRepos();
  }
});

Deno.test("app manifest - rejects missing workflow jobs during validation", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: missing-job
spec:
  version: 1.0.0
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
`,
      ".takos/workflows/build.yml": `
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
`,
    });

    await assertRejects(
      () => validateAppManifest(repoDir),
      Error,
      "Workflow job not found",
    );
  } finally {
    await cleanupTempRepos();
  }
});

Deno.test("app manifest - rejects deploy producer jobs that use needs", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: invalid-job
spec:
  version: 1.0.0
  workers:
    gateway:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-gateway
          artifact: gateway-dist
          artifactPath: dist/gateway.mjs
`,
      ".takos/workflows/build.yml": `
jobs:
  setup:
    runs-on: ubuntu-latest
    steps:
      - run: echo setup
  build-gateway:
    runs-on: ubuntu-latest
    needs: [setup]
    steps:
      - run: echo build
`,
    });

    await assertRejects(
      () => validateAppManifest(repoDir),
      Error,
      "must not use needs",
    );
  } finally {
    await cleanupTempRepos();
  }
});

Deno.test("app manifest - allows service-only manifests", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: service-only
spec:
  version: 1.0.0
  services:
    api:
      imageRef: ghcr.io/takos/api:latest
      port: 8080
`,
    });

    const manifest = await loadAppManifest(
      path.join(repoDir, ".takos/app.yml"),
    );
    assertEquals(manifest.spec.workers, undefined);
    assertObjectMatch(manifest.spec.services ?? {}, {
      api: {
        imageRef: "ghcr.io/takos/api:latest",
        port: 8080,
      },
    });
  } finally {
    await cleanupTempRepos();
  }
});

Deno.test("app manifest - preserves canonical and legacy binding aliases", async () => {
  try {
    const repoDir = await createTempRepo({
      ".takos/app.yml": `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: alias-app
spec:
  version: 1.0.0
  resources:
    events:
      type: analyticsEngine
    deploy-flow:
      type: workflow
      workflow:
        service: api
        export: run
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
      bindings:
        analytics: [events]
        workflows: [deploy-flow]
`,
      ".takos/workflows/build.yml": `
jobs:
  build-api:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
`,
    });

    const manifest = await loadAppManifest(
      path.join(repoDir, ".takos/app.yml"),
    );
    assertObjectMatch(manifest.spec.workers?.api ?? {}, {
      bindings: {
        analyticsEngine: ["events"],
        workflow: ["deploy-flow"],
      },
    });
  } finally {
    await cleanupTempRepos();
  }
});
