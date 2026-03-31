import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadAppManifest } from '../src/lib/app-manifest.ts';

import { assertEquals, assert, assertRejects, assertObjectMatch } from 'jsr:@std/assert';

const tempDirs: string[] = [];
async function createTempRepo(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'takos-app-manifest-'));
  tempDirs.push(dir);

  await Promise.all(Object.entries(files).map(async ([relativePath, content]) => {
    const fullPath = path.join(dir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
  }));

  return dir;
}


  Deno.test('app manifest - loads workers manifest', async () => {
  try {
  const repoDir = await createTempRepo({
      '.takos/app.yml': `
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

    const manifest = await loadAppManifest(path.join(repoDir, '.takos/app.yml'));

    assertEquals(manifest.metadata.name, 'sample-app');
    assert(manifest.spec.workers.gateway !== undefined);
    assertEquals(manifest.spec.workers.gateway.build.fromWorkflow, {
      path: '.takos/workflows/build.yml',
      job: 'build-gateway',
      artifact: 'gateway-dist',
      artifactPath: 'dist/gateway.mjs',
    });
    assertEquals(manifest.spec.routes.length, 1);
    assertEquals(manifest.spec.mcpServers.length, 1);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('app manifest - preserves the extended manifest surface', async () => {
  try {
  const repoDir = await createTempRepo({
      '.takos/app.yml': `
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
        analytics: [analytics]
        workflows: [workflowDispatch]
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
      '.takos/workflows/build.yml': `
jobs:
  build-api:
    runs-on: ubuntu-latest
    steps:
      - run: echo build
`,
      '.takos/migrations/main-db/up': 'create table test(id text);',
      '.takos/migrations/main-db/down': 'drop table test;',
    });

    const manifest = await loadAppManifest(path.join(repoDir, '.takos/app.yml'));

    assertObjectMatch(manifest.spec.containers?.browser, {
      dockerfile: 'packages/browser/Dockerfile',
      port: 8080,
      instanceType: 'standard-2',
      maxInstances: 3,
      env: { CHROME_FLAGS: '--headless=new' },
      volumes: [{ name: 'browser-cache', mountPath: '/cache', size: '1Gi' }],
    });
    assertObjectMatch(manifest.spec.services?.browserApi, {
      dockerfile: 'services/browser-api/Dockerfile',
      port: 3000,
      ipv4: true,
      env: { API_BASE: 'https://example.com' },
      healthCheck: { type: 'http', path: '/health' },
      bindings: { services: [{ name: 'api', version: '^1.0.0' }] },
      triggers: { schedules: [{ cron: '*/5 * * * *', export: 'sync' }] },
    });
    assertObjectMatch(manifest.spec.workers.api, {
      containers: ['browser'],
      env: { API_MODE: 'production' },
      bindings: {
        d1: ['main-db'],
        vectorize: ['searchIndex'],
        queues: ['jobQueue'],
        analytics: ['analytics'],
        workflows: ['workflowDispatch'],
        durableObjects: ['browserSessions'],
        services: ['browserApi'],
      },
      triggers: {
        schedules: [{ cron: '0 * * * *', export: 'cron' }],
        queues: [{ queue: 'jobQueue', export: 'handleJob' }],
      },
      healthCheck: { type: 'tcp', port: 8080 },
      scaling: { minInstances: 1, maxConcurrency: 10 },
      dependsOn: ['browserApi'],
    });
    assertEquals(manifest.spec.routes, [
      { name: 'api', target: 'api', path: '/api', ingress: 'api', methods: ['GET', 'POST'] },
      { name: 'browser', target: 'browser', path: '/browser' },
      { name: 'browserApi', target: 'browserApi', path: '/browser-api' },
    ]);
    assertEquals(manifest.spec.env, {
      required: ['API_KEY'],
      inject: {
        API_URL: '{{routes.api.url}}',
        BROWSER_PORT: '{{containers.browser.port}}',
        SEARCH_INDEX_ID: '{{resources.searchIndex.id}}',
      },
    });
    assertEquals(manifest.spec.mcpServers, [
      {
        name: 'browser-mcp',
        route: 'browserApi',
        authSecretRef: 'oauthSecret',
        transport: 'streamable-http',
      },
    ]);
    assertEquals(manifest.spec.overrides, {
      staging: {
        containers: {
          browser: {
            env: { CHROME_FLAGS: '--disable-dev-shm-usage' },
          },
        },
        workers: {
          api: {
            env: { API_MODE: 'staging' },
          },
        },
        services: {
          browserApi: {
            env: { API_BASE: 'https://staging.example.com' },
          },
        },
      },
    });
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('app manifest - rejects workers without fromWorkflow build source', async () => {
  try {
  const repoDir = await createTempRepo({
      '.takos/app.yml': `
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

    await await assertRejects(async () => { await loadAppManifest(path.join(repoDir, '.takos/app.yml')); }, 
      /build\.fromWorkflow or artifact\.kind=bundle/i,
    );
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('app manifest - rejects missing workflow files during validation', async () => {
  try {
  const repoDir = await createTempRepo({
      '.takos/app.yml': `
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

    const { validateAppManifest } = await import('../src/lib/app-manifest.ts');
    await await assertRejects(async () => { await validateAppManifest(repoDir); }, /Workflow file not found/);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('app manifest - rejects missing workflow jobs during validation', async () => {
  try {
  const repoDir = await createTempRepo({
      '.takos/app.yml': `
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
      '.takos/workflows/build.yml': `
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
`,
    });

    const { validateAppManifest } = await import('../src/lib/app-manifest.ts');
    await await assertRejects(async () => { await validateAppManifest(repoDir); }, /Workflow job not found/);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('app manifest - rejects deploy producer jobs that use needs', async () => {
  try {
  const repoDir = await createTempRepo({
      '.takos/app.yml': `
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
      '.takos/workflows/build.yml': `
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

    const { validateAppManifest } = await import('../src/lib/app-manifest.ts');
    await await assertRejects(async () => { await validateAppManifest(repoDir); }, /must not use needs/);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})
  Deno.test('app manifest - requires at least one worker', async () => {
  try {
  const repoDir = await createTempRepo({
      '.takos/app.yml': `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: no-workers
spec:
  version: 1.0.0
`,
    });

    await await assertRejects(async () => { await loadAppManifest(path.join(repoDir, '.takos/app.yml')); }, /spec.workers must contain at least one worker/);
  } finally {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
})