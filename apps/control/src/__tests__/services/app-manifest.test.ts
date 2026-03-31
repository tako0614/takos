import {
  appManifestToBundleDocs,
  parseAppManifestYaml,
} from '@/services/source/app-manifest';


import { assertEquals, assert, assertThrows, assertObjectMatch } from 'jsr:@std/assert';

  Deno.test('app manifest service - parses spec.services (常設コンテナ)', () => {
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

    assert(manifest.spec.services !== undefined);
    assertEquals(manifest.spec.services!['my-api'], {
      dockerfile: 'Dockerfile',
      port: 3000,
      ipv4: true,
    });
})
  Deno.test('app manifest service - parses direct-artifact worker and image-based service forms', () => {
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
        kind: 'image',
        imageRef: 'ghcr.io/takos/api:latest',
        provider: 'k8s',
      },
    });
    assertEquals(manifest.spec.workers?.web, {
      artifact: {
        kind: 'bundle',
        deploymentId: 'dep-web-1',
        artifactRef: 'worker-web-v1',
      },
    });
})
  Deno.test('app manifest service - rejects legacy local build fields', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
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
`); }, /local build fields are not supported/);
})
  Deno.test('app manifest service - parses vectorize resources and worker bindings', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: vector-app
spec:
  version: 1.0.0
  resources:
    semantic-index:
      type: vectorize
      binding: SEARCH_INDEX
      vectorize:
        dimensions: 768
        metric: euclidean
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
      bindings:
        vectorize: [semantic-index]
`);

    assertEquals(manifest.spec.resources?.['semantic-index'], {
      type: 'vectorize',
      binding: 'SEARCH_INDEX',
      vectorize: {
        dimensions: 768,
        metric: 'euclidean',
      },
    });
    const apiWorker = manifest.spec.workers!.api;
    assertEquals(apiWorker.bindings?.vectorize, ['semantic-index']);
})
  Deno.test('app manifest service - parses queue, analytics, workflow resources and worker triggers', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: runtime-app
spec:
  version: 1.0.0
  resources:
    jobs:
      type: queue
      binding: JOBS
      queue:
        maxRetries: 5
        deliveryDelaySeconds: 10
        deadLetterQueue: jobs-dlq
    jobs-dlq:
      type: queue
      binding: JOBS_DLQ
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
        analytics: [events]
        workflows: [onboarding]
      triggers:
        schedules:
          - cron: '*/5 * * * *'
            export: handleCron
        queues:
          - queue: jobs
            export: handleJob
`);

    assertEquals(manifest.spec.resources?.jobs, {
      type: 'queue',
      binding: 'JOBS',
      queue: {
        maxRetries: 5,
        deliveryDelaySeconds: 10,
        deadLetterQueue: 'jobs-dlq',
      },
    });
    assertEquals(manifest.spec.resources?.events, {
      type: 'analyticsEngine',
      binding: 'ANALYTICS',
      analyticsEngine: {
        dataset: 'tenant-events',
      },
    });
    assertEquals(manifest.spec.resources?.onboarding, {
      type: 'workflow',
      binding: 'ONBOARDING_FLOW',
      workflow: {
        service: 'api',
        export: 'runOnboarding',
        timeoutMs: 60000,
        maxRetries: 3,
      },
    });
    const apiWorker = manifest.spec.workers!.api;
    assertObjectMatch(apiWorker.bindings, {
      queues: ['jobs'],
      analytics: ['events'],
      workflows: ['onboarding'],
    });
    assertEquals(apiWorker.triggers, {
      schedules: [{ cron: '*/5 * * * *', export: 'handleCron' }],
      queues: [{ queue: 'jobs', export: 'handleJob' }],
    });
})
  Deno.test('app manifest service - emits vectorize resources and bundle docs for worker artifacts', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: vector-app
spec:
  version: 1.0.0
  resources:
    semantic-index:
      type: vectorize
      binding: SEARCH_INDEX
      vectorize:
        dimensions: 1536
        metric: cosine
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
      bindings:
        vectorize: [semantic-index]
`);

    const docs = appManifestToBundleDocs(manifest, new Map([
      ['api', {
        service_name: 'api',
        workflow_path: '.takos/workflows/build.yml',
        workflow_job: 'build-api',
        workflow_artifact: 'api-dist',
        artifact_path: 'dist/api.mjs',
      }],
    ]));

    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Resource',
      metadata: { name: 'semantic-index' },
      spec: ({
        type: 'vectorize',
        binding: 'SEARCH_INDEX',
        vectorize: {
          dimensions: 1536,
          metric: 'cosine',
        },
      }),
    }))));
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Workload',
      metadata: ({ name: 'api' }),
      spec: ({
        pluginConfig: ({
          bindings: ({
            services: [],
          }),
        }),
      }),
    }))));
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Binding',
      metadata: { name: 'semantic-index-to-api' },
      spec: ({
        from: 'semantic-index',
        to: 'api',
        mount: ({
          as: 'SEARCH_INDEX',
          type: 'vectorize',
        }),
      }),
    }))));
})
  Deno.test('app manifest service - parses worker with container references', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: container-app
spec:
  version: 1.0.0
  containers:
    browser:
      dockerfile: packages/browser-service/Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 25
  workers:
    browser-host:
      containers: [browser]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-browser-host
          artifact: browser-host
          artifactPath: dist/browser-host.js
`);

    assertEquals(manifest.spec.containers!.browser, {
      dockerfile: 'packages/browser-service/Dockerfile',
      port: 8080,
      instanceType: 'standard-2',
      maxInstances: 25,
    });
    assertEquals(manifest.spec.workers!['browser-host'].containers, ['browser']);
})
  Deno.test('app manifest service - emits worker containers into bundle docs', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: container-app
spec:
  version: 1.0.0
  containers:
    browser:
      dockerfile: packages/browser-service/Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 25
  workers:
    browser-host:
      containers: [browser]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-browser-host
          artifact: browser-host
          artifactPath: dist/browser-host.js
`);

    const docs = appManifestToBundleDocs(manifest, new Map([
      ['browser-host', {
        service_name: 'browser-host',
        workflow_path: '.takos/workflows/deploy.yml',
        workflow_job: 'build-browser-host',
        workflow_artifact: 'browser-host',
        artifact_path: 'dist/browser-host.js',
      }],
    ]));

    // Worker workload should include containers in pluginConfig
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Workload',
      metadata: ({ name: 'browser-host' }),
      spec: ({
        type: 'cloudflare.worker',
        pluginConfig: ({
          containers: [{
            name: 'browser',
            dockerfile: 'packages/browser-service/Dockerfile',
            port: 8080,
            instanceType: 'standard-2',
            maxInstances: 25,
          }],
        }),
      }),
    }))));

    // Container workload doc should be emitted
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Workload',
      metadata: { name: 'browser-host-browser' },
      spec: ({
        type: 'container',
        parentRef: 'browser-host',
        pluginConfig: {
          dockerfile: 'packages/browser-service/Dockerfile',
          port: 8080,
          instanceType: 'standard-2',
          maxInstances: 25,
        },
      }),
    }))));

    // Binding from container to worker should be emitted
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Binding',
      metadata: { name: 'browser-container-to-browser-host' },
      spec: ({
        from: 'browser-host-browser',
        to: 'browser-host',
        mount: {
          as: 'BROWSER_CONTAINER',
          type: 'durableObject',
        },
      }),
    }))));
})
  Deno.test('app manifest service - emits queue, analytics, workflow resources and trigger metadata into bundle docs', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: tenant-runtime
spec:
  version: 1.0.0
  resources:
    jobs:
      type: queue
      binding: JOBS
      queue:
        maxRetries: 2
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
        analytics: [events]
        workflows: [onboarding]
      triggers:
        schedules:
          - cron: '0 * * * *'
            export: handleHourly
        queues:
          - queue: jobs
            export: handleJob
`);

    const docs = appManifestToBundleDocs(manifest, new Map([
      ['api', {
        service_name: 'api',
        workflow_path: '.takos/workflows/build.yml',
        workflow_job: 'build-api',
        workflow_artifact: 'api-dist',
        artifact_path: 'dist/api.mjs',
      }],
    ]));

    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Resource',
      metadata: { name: 'jobs' },
      spec: ({
        type: 'queue',
        binding: 'JOBS',
        queue: {
          maxRetries: 2,
        },
      }),
    }))));
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Resource',
      metadata: { name: 'events' },
      spec: ({
        type: 'analyticsEngine',
        binding: 'ANALYTICS',
        analyticsEngine: {
          dataset: 'tenant-events',
        },
      }),
    }))));
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Resource',
      metadata: { name: 'onboarding' },
      spec: ({
        type: 'workflow',
        binding: 'ONBOARDING_FLOW',
        workflow: {
          service: 'api',
          export: 'runOnboarding',
        },
      }),
    }))));
    assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
      kind: 'Workload',
      metadata: { name: 'api', labels: /* expect.any(Object) */ {} as any },
      spec: ({
        pluginConfig: ({
          bindings: ({
            services: [],
          }),
          triggers: {
            schedules: [{ cron: '0 * * * *', export: 'handleHourly' }],
            queues: [{ queue: 'jobs', export: 'handleJob' }],
          },
        }),
      }),
    }))));
})
  // ============================================================
  // Containers + workers + routes
  // ============================================================

  
    Deno.test('app manifest service - containers + workers format - parses containers and workers with separated sections', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: new-format-app
spec:
  version: 2.0.0
  containers:
    executor:
      dockerfile: packages/executor/Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 10
  workers:
    browser-host:
      containers: [executor]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-browser-host
          artifact: browser-host
          artifactPath: dist/browser-host.js
  routes:
    - name: browser-api
      target: browser-host
      path: /api
`);

      assert(manifest.spec.containers !== undefined);
      assertEquals(manifest.spec.containers!.executor, {
        dockerfile: 'packages/executor/Dockerfile',
        port: 8080,
        instanceType: 'standard-2',
        maxInstances: 10,
      });

      assert(manifest.spec.workers !== undefined);
      assertEquals(manifest.spec.workers!['browser-host'], {
        containers: ['executor'],
        build: {
          fromWorkflow: {
            path: '.takos/workflows/deploy.yml',
            job: 'build-browser-host',
            artifact: 'browser-host',
            artifactPath: 'dist/browser-host.js',
          },
        },
      });

      assertEquals(manifest.spec.routes.length, 1);
      assertEquals(manifest.spec.routes![0], {
        name: 'browser-api',
        target: 'browser-host',
        path: '/api',
      });
})
    Deno.test('app manifest service - containers + workers format - validates worker container references', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: bad-ref-app
spec:
  version: 1.0.0
  containers:
    executor:
      dockerfile: Dockerfile
      port: 8080
  workers:
    api:
      containers: [nonexistent]
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
`); }, /references unknown container: nonexistent/);
})
    Deno.test('app manifest service - containers + workers format - validates route target references', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: bad-route-app
spec:
  version: 1.0.0
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
  routes:
    - name: main
      target: nonexistent
`); }, /references unknown worker, container, or service: nonexistent/);
})
    Deno.test('app manifest service - containers + workers format - requires name on routes', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: nameless-route-app
spec:
  version: 1.0.0
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
  routes:
    - target: api
`); }, /spec\.routes\[0\]\.name is required/);
})
    Deno.test('app manifest service - containers + workers format - parses env.inject with template variables', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: template-app
spec:
  version: 1.0.0
  env:
    required: [API_KEY]
    inject:
      BROWSER_URL: "{{workers.browser-host.url}}"
      ROUTE_URL: "{{routes.api.url}}"
  workers:
    browser-host:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js
  routes:
    - name: api
      target: browser-host
`);

      assertEquals(manifest.spec.env, {
        required: ['API_KEY'],
        inject: {
          BROWSER_URL: '{{workers.browser-host.url}}',
          ROUTE_URL: '{{routes.api.url}}',
        },
      });
})
    Deno.test('app manifest service - containers + workers format - rejects env.inject with invalid template references', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: bad-template-app
spec:
  version: 1.0.0
  env:
    inject:
      BAD_URL: "{{workers.nonexistent.url}}"
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
`); }, /template errors.*worker "nonexistent" not found/);
})
    Deno.test('app manifest service - containers + workers format - rejects mcpServers that specify both route and endpoint', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: bad-mcp-app
spec:
  version: 1.0.0
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
  routes:
    - name: api
      target: api
  mcpServers:
    - name: api-mcp
      route: api
      endpoint: https://example.com/mcp
`); }, /must not specify both endpoint and route/);
})
    Deno.test('app manifest service - containers + workers format - rejects mcpServers that reference unknown routes', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: missing-route-mcp
spec:
  version: 1.0.0
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
  routes:
    - name: api
      target: api
  mcpServers:
    - name: api-mcp
      route: missing
`); }, /route references unknown route: missing/);
})
    Deno.test('app manifest service - containers + workers format - rejects mcpServers authSecretRef that is not a secret resource', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: bad-auth-secret
spec:
  version: 1.0.0
  resources:
    db:
      type: d1
      binding: DB
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
  routes:
    - name: api
      target: api
  mcpServers:
    - name: api-mcp
      route: api
      authSecretRef: db
`); }, /authSecretRef must reference a secretRef resource: db/);
})
    Deno.test('app manifest service - containers + workers format - parses workers with queue bindings and triggers', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: full-worker-app
spec:
  version: 1.0.0
  resources:
    jobs:
      type: queue
      binding: JOBS
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
      env:
        NODE_ENV: production
      bindings:
        queues: [jobs]
      triggers:
        schedules:
          - cron: '*/5 * * * *'
            export: handleCron
        queues:
          - queue: jobs
            export: handleJob
`);

    const worker = manifest.spec.workers!.api;
    assertEquals(worker.env, { NODE_ENV: 'production' });
    assertEquals(worker.bindings, {
      queues: ['jobs'],
    });
      assertEquals(worker.triggers, {
        schedules: [{ cron: '*/5 * * * *', export: 'handleCron' }],
        queues: [{ queue: 'jobs', export: 'handleJob' }],
      });
})
    Deno.test('app manifest service - containers + workers format - parses container env', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: container-env-app
spec:
  version: 1.0.0
  containers:
    executor:
      dockerfile: Dockerfile
      port: 8080
      env:
        NODE_ENV: production
        PORT: "8080"
  workers:
    api:
      containers: [executor]
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
`);

      assertEquals(manifest.spec.containers!.executor.env, {
        NODE_ENV: 'production',
        PORT: '8080',
      });
})
    Deno.test('app manifest service - containers + workers format - parses services with ipv4 and env', () => {
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
      env:
        NODE_ENV: production
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js
`);

      assert(manifest.spec.services !== undefined);
      assertEquals(manifest.spec.services!['my-api'], {
        dockerfile: 'Dockerfile',
        port: 3000,
        ipv4: true,
        env: { NODE_ENV: 'production' },
      });
})
    Deno.test('app manifest service - containers + workers format - allows routes to target services', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: service-route-app
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
  routes:
    - name: api
      target: my-api
      path: /api
`);

      assertEquals(manifest.spec.routes.length, 1);
      assertEquals(manifest.spec.routes![0], {
        name: 'api',
        target: 'my-api',
        path: '/api',
      });
})
    Deno.test('app manifest service - containers + workers format - emits services into bundle docs as type service', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: service-bundle-app
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

      const docs = appManifestToBundleDocs(manifest, new Map([
        ['web', {
          service_name: 'web',
          workflow_path: '.takos/workflows/build.yml',
          workflow_job: 'build',
          workflow_artifact: 'dist',
          artifact_path: 'dist/worker.js',
        }],
      ]));

      assert(docs.some((item: any) => JSON.stringify(item) === JSON.stringify(({
        kind: 'Workload',
        metadata: { name: 'my-api' },
        spec: ({
          type: 'service',
          pluginConfig: {
            dockerfile: 'Dockerfile',
            port: 3000,
            ipv4: true,
          },
        }),
      }))));
})
    Deno.test('app manifest service - containers + workers format - validates env.inject with services template references', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: service-template-app
spec:
  version: 1.0.0
  env:
    inject:
      API_IP: "{{services.my-api.ipv4}}"
      API_PORT: "{{services.my-api.port}}"
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

      assertEquals(manifest.spec.env, {
        inject: {
          API_IP: '{{services.my-api.ipv4}}',
          API_PORT: '{{services.my-api.port}}',
        },
      });
})
    Deno.test('app manifest service - containers + workers format - rejects env.inject referencing unknown service', () => {
  assertThrows(() => { () => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: bad-service-ref
spec:
  version: 1.0.0
  env:
    inject:
      BAD: "{{services.nonexistent.ipv4}}"
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js
`); }, /template errors.*service "nonexistent" not found/);
})  
  // ============================================================
  // 7 つの新仕様テスト
  // ============================================================

  // --- YAML ヘルパー ---

  const minWorkerYaml = `
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js`;

  function yaml(overrides: {
    version?: string;
    workers?: string;
    lifecycle?: string;
    update?: string;
    takos?: string;
    resources?: string;
    services?: string;
    routes?: string;
    containers?: string;
    env?: string;
    overrides?: string;
  }): string {
    return `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: test-app
spec:
  version: ${overrides.version ?? '1.0.0'}
${overrides.overrides ? `  overrides:\n${overrides.overrides}` : ''}
${overrides.env ? `  env:\n${overrides.env}` : ''}
${overrides.resources ? `  resources:\n${overrides.resources}` : ''}
${overrides.containers ? `  containers:\n${overrides.containers}` : ''}
${overrides.services ? `  services:\n${overrides.services}` : ''}
  workers:
${overrides.workers ?? `    web:${minWorkerYaml}`}
${overrides.routes ? `  routes:\n${overrides.routes}` : ''}
${overrides.lifecycle ? `  lifecycle:\n${overrides.lifecycle}` : ''}
${overrides.update ? `  update:\n${overrides.update}` : ''}
${overrides.takos ? `  takos:\n${overrides.takos}` : ''}
`;
  }

  // ============================================================
  // 1. Semver バリデーション
  // ============================================================

  
    Deno.test('app manifest service - semver validation - rejects invalid semver', () => {
  assertThrows(() => { () => parseAppManifestYaml(yaml({ version: 'banana' })); }, 
        'spec.version must be valid semver',
      );
})
    Deno.test('app manifest service - semver validation - rejects v-prefixed version', () => {
  assertThrows(() => { () => parseAppManifestYaml(yaml({ version: 'v1.0.0' })); }, 
        'spec.version must be valid semver',
      );
})
    Deno.test('app manifest service - semver validation - rejects incomplete semver', () => {
  assertThrows(() => { () => parseAppManifestYaml(yaml({ version: "'1.0'" })); }, 
        'spec.version must be valid semver',
      );
})
    Deno.test('app manifest service - semver validation - accepts semver with prerelease', () => {
  const manifest = parseAppManifestYaml(yaml({ version: '1.0.0-beta.1' }));
      assertEquals(manifest.spec.version, '1.0.0-beta.1');
})
    Deno.test('app manifest service - semver validation - accepts semver with build metadata', () => {
  const manifest = parseAppManifestYaml(yaml({ version: '1.0.0+build.123' }));
      assertEquals(manifest.spec.version, '1.0.0+build.123');
})
    Deno.test('app manifest service - semver validation - accepts standard semver', () => {
  const manifest = parseAppManifestYaml(yaml({ version: '0.1.0' }));
      assertEquals(manifest.spec.version, '0.1.0');
})  
  // ============================================================
  // 2. ヘルスチェック
  // ============================================================

  
    Deno.test('app manifest service - healthCheck - parses worker healthCheck', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      healthCheck:
        path: /health
        intervalSeconds: 30`,
      }));
      assertEquals(manifest.spec.workers?.web.healthCheck?.path, '/health');
      assertEquals(manifest.spec.workers?.web.healthCheck?.intervalSeconds, 30);
})
    Deno.test('app manifest service - healthCheck - parses worker healthCheck with all fields', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      healthCheck:
        path: /healthz
        intervalSeconds: 15
        timeoutSeconds: 5
        unhealthyThreshold: 3`,
      }));
      assertEquals(manifest.spec.workers?.web.healthCheck, {
        path: '/healthz',
        intervalSeconds: 15,
        timeoutSeconds: 5,
        unhealthyThreshold: 3,
      });
})
    Deno.test('app manifest service - healthCheck - parses service healthCheck', () => {
  const manifest = parseAppManifestYaml(yaml({
        services: `    my-api:
      dockerfile: Dockerfile
      port: 3000
      healthCheck:
        path: /health
        intervalSeconds: 60`,
      }));
      assertEquals(manifest.spec.services!['my-api'].healthCheck?.path, '/health');
      assertEquals(manifest.spec.services!['my-api'].healthCheck?.intervalSeconds, 60);
})  
  // ============================================================
  // 3. ライフサイクルフック
  // ============================================================

  
    Deno.test('app manifest service - lifecycle hooks - parses lifecycle hooks', () => {
  const manifest = parseAppManifestYaml(yaml({
        lifecycle: `    preApply:
      command: pnpm run migrate
      timeoutSeconds: 120
    postApply:
      command: pnpm run seed`,
      }));
      assertEquals(manifest.spec.lifecycle?.preApply?.command, 'pnpm run migrate');
      assertEquals(manifest.spec.lifecycle?.preApply?.timeoutSeconds, 120);
      assertEquals(manifest.spec.lifecycle?.postApply?.command, 'pnpm run seed');
      assertEquals(manifest.spec.lifecycle?.postApply?.timeoutSeconds, undefined);
})
    Deno.test('app manifest service - lifecycle hooks - parses lifecycle with only preApply', () => {
  const manifest = parseAppManifestYaml(yaml({
        lifecycle: `    preApply:
      command: pnpm run migrate`,
      }));
      assertEquals(manifest.spec.lifecycle?.preApply?.command, 'pnpm run migrate');
      assertEquals(manifest.spec.lifecycle?.postApply, undefined);
})
    Deno.test('app manifest service - lifecycle hooks - omits lifecycle when not specified', () => {
  const manifest = parseAppManifestYaml(yaml({}));
      assertEquals(manifest.spec.lifecycle, undefined);
})  
  // ============================================================
  // 4. 依存バージョン制約 (service binding)
  // ============================================================

  
    Deno.test('app manifest service - service binding version constraint - parses service binding with version constraint', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        services:
          - name: other
            version: ">=2.0.0"`,
      }));
      const svc = manifest.spec.workers?.web.bindings?.services;
      assertEquals(svc.length, 1);
      assertEquals(svc![0], { name: 'other', version: '>=2.0.0' });
})
    Deno.test('app manifest service - service binding version constraint - accepts plain string service bindings', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        services:
          - other-worker`,
      }));
      const svc = manifest.spec.workers?.web.bindings?.services;
      assertEquals(svc, ['other-worker']);
})
    Deno.test('app manifest service - service binding version constraint - accepts mixed string and object service bindings', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        services:
          - simple-svc
          - name: versioned-svc
            version: "^1.0.0"`,
      }));
      const svc = manifest.spec.workers?.web.bindings?.services;
      assertEquals(svc.length, 2);
      assertEquals(svc![0], 'simple-svc');
      assertEquals(svc![1], { name: 'versioned-svc', version: '^1.0.0' });
})  
  // ============================================================
  // 5. プラットフォーム最小バージョン (takos.minVersion)
  // ============================================================

  
    Deno.test('app manifest service - takos.minVersion - parses takos.minVersion', () => {
  const manifest = parseAppManifestYaml(yaml({
        takos: `    scopes:
      - threads:read
    minVersion: '2.0.0'`,
      }));
      assertEquals(manifest.spec.takos?.minVersion, '2.0.0');
      assertEquals(manifest.spec.takos?.scopes, ['threads:read']);
})
    Deno.test('app manifest service - takos.minVersion - accepts takos without minVersion', () => {
  const manifest = parseAppManifestYaml(yaml({
        takos: `    scopes:
      - threads:read`,
      }));
      assertEquals(manifest.spec.takos?.scopes, ['threads:read']);
      assertEquals(manifest.spec.takos?.minVersion, undefined);
})  
  // ============================================================
  // 6. ロールバック戦略 (update)
  // ============================================================

  
    Deno.test('app manifest service - update strategy - parses update strategy', () => {
  const manifest = parseAppManifestYaml(yaml({
        update: `    strategy: canary
    canaryWeight: 10
    rollbackOnFailure: true`,
      }));
      assertEquals(manifest.spec.update?.strategy, 'canary');
      assertEquals(manifest.spec.update?.canaryWeight, 10);
      assertEquals(manifest.spec.update?.rollbackOnFailure, true);
})
    Deno.test('app manifest service - update strategy - parses blue-green strategy', () => {
  const manifest = parseAppManifestYaml(yaml({
        update: `    strategy: blue-green
    timeoutSeconds: 300`,
      }));
      assertEquals(manifest.spec.update?.strategy, 'blue-green');
      assertEquals(manifest.spec.update?.timeoutSeconds, 300);
})
    Deno.test('app manifest service - update strategy - parses rolling strategy', () => {
  const manifest = parseAppManifestYaml(yaml({
        update: `    strategy: rolling`,
      }));
      assertEquals(manifest.spec.update?.strategy, 'rolling');
})
    Deno.test('app manifest service - update strategy - rejects invalid strategy', () => {
  assertThrows(() => { () =>
        parseAppManifestYaml(yaml({
          update: `    strategy: yolo`,
        })),
      ; }, 'spec.update.strategy must be');
})
    Deno.test('app manifest service - update strategy - omits update when not specified', () => {
  const manifest = parseAppManifestYaml(yaml({}));
      assertEquals(manifest.spec.update, undefined);
})  
  // ============================================================
  // 7. マイグレーション拡張 (kv resources)
  // ============================================================

  
    Deno.test('app manifest service - kv resource migrations - allows migrations on kv resources', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        kv:
          - cache`,
        resources: `    cache:
      type: kv
      binding: CACHE
      migrations: .takos/migrations/cache`,
      }));
      assertEquals(manifest.spec.resources?.cache.migrations, '.takos/migrations/cache');
      assertEquals(manifest.spec.resources?.cache.type, 'kv');
      assertEquals(manifest.spec.resources?.cache.binding, 'CACHE');
})
    Deno.test('app manifest service - kv resource migrations - allows migrations with up/down on kv resources', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        kv:
          - cache`,
        resources: `    cache:
      type: kv
      binding: CACHE
      migrations:
        up: .takos/migrations/cache/up
        down: .takos/migrations/cache/down`,
      }));
      assertEquals(manifest.spec.resources?.cache.migrations, {
        up: '.takos/migrations/cache/up',
        down: '.takos/migrations/cache/down',
      });
})  
  // ============================================================
  // 13 個の新仕様テスト
  // ============================================================

  // --- 1. Environment overrides ---

  
    Deno.test('app manifest service - environment overrides - parses environment overrides', () => {
  const manifest = parseAppManifestYaml(yaml({
        overrides: `    staging:
      containers:
        browser:
          maxInstances: 2`,
        containers: `    browser:
      dockerfile: Dockerfile
      port: 8080
      maxInstances: 10`,
      }));
      assert(manifest.spec.overrides !== undefined);
      assertEquals(manifest.spec.overrides!.staging.containers.browser.maxInstances, 2);
})  
  // --- 2. Lifecycle sandbox ---

  
    Deno.test('app manifest service - lifecycle sandbox - parses lifecycle hook sandbox flag', () => {
  const manifest = parseAppManifestYaml(yaml({
        lifecycle: `    preApply:
      command: pnpm run migrate
      sandbox: true`,
      }));
      assertEquals(manifest.spec.lifecycle?.preApply?.sandbox, true);
})  
  // --- 3. Service bindings on services ---

  
    Deno.test('app manifest service - service bindings on services - parses service bindings on services', () => {
  const manifest = parseAppManifestYaml(yaml({
        services: `    api:
      dockerfile: Dockerfile
      port: 3000
      bindings:
        services:
          - other`,
      }));
      assertEquals(manifest.spec.services!.api.bindings?.services, ['other']);
})  
  
    Deno.test('app manifest service - provider-neutral manifest syntax - parses neutral resource classes and service/container resource bindings', () => {
  const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: neutral-app
spec:
  version: 1.0.0
  resources:
    tenant-db:
      type: d1
      binding: DB
    assets:
      type: r2
      binding: ASSETS
  containers:
    browser:
      dockerfile: Dockerfile.browser
      port: 8080
  services:
    api:
      dockerfile: Dockerfile
      port: 3000
      bindings:
        services:
          - browser
  workers:
    edge:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/worker.js
  routes:
    - name: browser-route
      ingress: edge
      target: browser
      path: /browser
`);

      assertObjectMatch(manifest.spec.resources?.['tenant-db'], {
        type: 'd1',
      });
      assertObjectMatch(manifest.spec.resources?.assets, {
        type: 'r2',
      });
      assertObjectMatch(manifest.spec.services?.api.bindings, {
        services: ['browser'],
      });
      assertObjectMatch(manifest.spec.routes?.[0], {
        name: 'browser-route',
        ingress: 'edge',
        target: 'browser',
      });
})  
  // --- 4. Worker scaling ---

  
    Deno.test('app manifest service - worker scaling - parses worker scaling', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      scaling:
        minInstances: 1
        maxConcurrency: 10`,
      }));
      assertEquals(manifest.spec.workers?.web.scaling, {
        minInstances: 1,
        maxConcurrency: 10,
      });
})  
  // --- 5. Volumes ---

  
    Deno.test('app manifest service - service volumes - parses service volumes', () => {
  const manifest = parseAppManifestYaml(yaml({
        services: `    db:
      dockerfile: Dockerfile
      port: 5432
      volumes:
        - name: data
          mountPath: /data
          size: 10Gi`,
      }));
      assertEquals(manifest.spec.services!.db.volumes, [
        { name: 'data', mountPath: '/data', size: '10Gi' },
      ]);
})  
  // --- 6. Health check types ---

  
    Deno.test('app manifest service - health check types - parses tcp health check', () => {
  const manifest = parseAppManifestYaml(yaml({
        services: `    db:
      dockerfile: Dockerfile
      port: 5432
      healthCheck:
        type: tcp
        port: 5432`,
      }));
      assertEquals(manifest.spec.services!.db.healthCheck, {
        type: 'tcp',
        port: 5432,
      });
})
    Deno.test('app manifest service - health check types - parses exec health check', () => {
  const manifest = parseAppManifestYaml(yaml({
        services: `    db:
      dockerfile: Dockerfile
      port: 5432
      healthCheck:
        type: exec
        command: pg_isready`,
      }));
      assertEquals(manifest.spec.services!.db.healthCheck, {
        type: 'exec',
        command: 'pg_isready',
      });
})
    Deno.test('app manifest service - health check types - rejects invalid health check type', () => {
  assertThrows(() => { () => parseAppManifestYaml(yaml({
        services: `    db:
      dockerfile: Dockerfile
      port: 5432
      healthCheck:
        type: grpc`,
      })); });
})  
  // --- 7. Service triggers ---

  
    Deno.test('app manifest service - service triggers - parses service schedules', () => {
  const manifest = parseAppManifestYaml(yaml({
        services: `    worker:
      dockerfile: Dockerfile
      port: 8080
      triggers:
        schedules:
          - cron: '*/5 * * * *'
            export: runJob`,
      }));
      assertEquals(manifest.spec.services!.worker.triggers?.schedules, [
        { cron: '*/5 * * * *', export: 'runJob' },
      ]);
})  
  // --- 8. DependsOn ---

  
    Deno.test('app manifest service - dependsOn - parses worker dependsOn', () => {
  const manifest = parseAppManifestYaml(yaml({
        services: `    api:
      dockerfile: Dockerfile
      port: 3000`,
        workers: `    web:${minWorkerYaml}
      dependsOn:
        - api`,
      }));
      assertEquals(manifest.spec.workers?.web.dependsOn, ['api']);
})  
  // --- 9. Resource limits ---

  
    Deno.test('app manifest service - resource limits - parses resource limits', () => {
  const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        d1:
          - db`,
        resources: `    db:
      type: d1
      binding: DB
      limits:
        maxSizeMb: 500`,
      }));
      assertEquals(manifest.spec.resources?.db.limits, { maxSizeMb: 500 });
})  
  // --- 10. Route methods ---

  
    Deno.test('app manifest service - route methods - parses route methods', () => {
  const manifest = parseAppManifestYaml(yaml({
        routes: `    - name: api
      target: web
      methods:
        - GET
        - POST`,
      }));
      assertEquals(manifest.spec.routes![0].methods, ['GET', 'POST']);
})
    Deno.test('app manifest service - route methods - rejects invalid route method', () => {
  assertThrows(() => { () => parseAppManifestYaml(yaml({
        routes: `    - name: api
      target: web
      methods:
        - YOLO`,
      })); });
})  
  // --- 11. Recreate strategy ---

  
    Deno.test('app manifest service - recreate strategy - accepts recreate strategy', () => {
  const manifest = parseAppManifestYaml(yaml({
        update: `    strategy: recreate`,
      }));
      assertEquals(manifest.spec.update?.strategy, 'recreate');
})  