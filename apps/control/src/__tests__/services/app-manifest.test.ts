import { describe, expect, it } from 'vitest';
import {
  appManifestToBundleDocs,
  extractBuildSourcesFromManifestJson,
  parseAppManifestYaml,
} from '@/services/source/app-manifest';

describe('app manifest service', () => {
  it('parses spec.services (常設コンテナ)', () => {
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

    expect(manifest.spec.services).toBeDefined();
    expect(manifest.spec.services!['my-api']).toEqual({
      dockerfile: 'Dockerfile',
      port: 3000,
      ipv4: true,
    });
  });

  it('rejects legacy local build fields', () => {
    expect(() => parseAppManifestYaml(`
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
`)).toThrow(/local build fields are not supported/);
  });

  it('parses vectorize resources and worker bindings', () => {
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

    expect(manifest.spec.resources?.['semantic-index']).toEqual({
      type: 'vectorize',
      binding: 'SEARCH_INDEX',
      vectorize: {
        dimensions: 768,
        metric: 'euclidean',
      },
    });
    const apiWorker = manifest.spec.workers!.api;
    expect(apiWorker.bindings?.vectorize).toEqual(['semantic-index']);
  });

  it('parses queue, analyticsEngine, workflow resources and worker triggers', () => {
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

    expect(manifest.spec.resources?.jobs).toEqual({
      type: 'queue',
      binding: 'JOBS',
      queue: {
        maxRetries: 5,
        deliveryDelaySeconds: 10,
        deadLetterQueue: 'jobs-dlq',
      },
    });
    expect(manifest.spec.resources?.events).toEqual({
      type: 'analyticsEngine',
      binding: 'ANALYTICS',
      analyticsEngine: {
        dataset: 'tenant-events',
      },
    });
    expect(manifest.spec.resources?.onboarding).toEqual({
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
    expect(apiWorker.bindings).toMatchObject({
      queues: ['jobs'],
      analytics: ['events'],
      workflows: ['onboarding'],
    });
    expect(apiWorker.triggers).toEqual({
      schedules: [{ cron: '*/5 * * * *', export: 'handleCron' }],
      queues: [{ queue: 'jobs', export: 'handleJob' }],
    });
  });

  it('emits vectorize resources and worker bindings into bundle docs', () => {
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

    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Resource',
      metadata: { name: 'semantic-index' },
      spec: expect.objectContaining({
        type: 'vectorize',
        binding: 'SEARCH_INDEX',
        vectorize: {
          dimensions: 1536,
          metric: 'cosine',
        },
      }),
    }));
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Workload',
      metadata: expect.objectContaining({ name: 'api' }),
      spec: expect.objectContaining({
        pluginConfig: expect.objectContaining({
          bindings: {
            services: [],
          },
        }),
      }),
    }));
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Binding',
      metadata: { name: 'semantic-index-to-api' },
      spec: expect.objectContaining({
        from: 'semantic-index',
        to: 'api',
        mount: expect.objectContaining({
          as: 'SEARCH_INDEX',
          type: 'vectorize',
        }),
      }),
    }));
  });

  it('parses worker with container references', () => {
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

    expect(manifest.spec.containers!.browser).toEqual({
      dockerfile: 'packages/browser-service/Dockerfile',
      port: 8080,
      instanceType: 'standard-2',
      maxInstances: 25,
    });
    expect(manifest.spec.workers!['browser-host'].containers).toEqual(['browser']);
  });

  it('emits worker containers into bundle docs', () => {
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
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Workload',
      metadata: expect.objectContaining({ name: 'browser-host' }),
      spec: expect.objectContaining({
        type: 'cloudflare.worker',
        pluginConfig: expect.objectContaining({
          containers: [{
            name: 'browser',
            dockerfile: 'packages/browser-service/Dockerfile',
            port: 8080,
            instanceType: 'standard-2',
            maxInstances: 25,
          }],
        }),
      }),
    }));

    // Container workload doc should be emitted
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Workload',
      metadata: { name: 'browser-host-browser' },
      spec: expect.objectContaining({
        type: 'container',
        parentRef: 'browser-host',
        pluginConfig: {
          dockerfile: 'packages/browser-service/Dockerfile',
          port: 8080,
          instanceType: 'standard-2',
          maxInstances: 25,
        },
      }),
    }));

    // Binding from container to worker should be emitted
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Binding',
      metadata: { name: 'browser-container-to-browser-host' },
      spec: expect.objectContaining({
        from: 'browser-host-browser',
        to: 'browser-host',
        mount: {
          as: 'BROWSER_CONTAINER',
          type: 'durableObject',
        },
      }),
    }));
  });

  it('emits queue, analyticsEngine, workflow resources and trigger metadata into bundle docs', () => {
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

    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Resource',
      metadata: { name: 'jobs' },
      spec: expect.objectContaining({
        type: 'queue',
        binding: 'JOBS',
        queue: {
          maxRetries: 2,
        },
      }),
    }));
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Resource',
      metadata: { name: 'events' },
      spec: expect.objectContaining({
        type: 'analyticsEngine',
        binding: 'ANALYTICS',
        analyticsEngine: {
          dataset: 'tenant-events',
        },
      }),
    }));
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Resource',
      metadata: { name: 'onboarding' },
      spec: expect.objectContaining({
        type: 'workflow',
        binding: 'ONBOARDING_FLOW',
        workflow: {
          service: 'api',
          export: 'runOnboarding',
        },
      }),
    }));
    expect(docs).toContainEqual(expect.objectContaining({
      kind: 'Workload',
      metadata: { name: 'api', labels: expect.any(Object) },
      spec: expect.objectContaining({
        pluginConfig: expect.objectContaining({
          bindings: {
            services: [],
          },
          triggers: {
            schedules: [{ cron: '0 * * * *', export: 'handleHourly' }],
            queues: [{ queue: 'jobs', export: 'handleJob' }],
          },
        }),
      }),
    }));
  });

  // ============================================================
  // Containers + workers + routes
  // ============================================================

  describe('containers + workers format', () => {
    it('parses containers and workers with separated sections', () => {
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

      expect(manifest.spec.containers).toBeDefined();
      expect(manifest.spec.containers!.executor).toEqual({
        dockerfile: 'packages/executor/Dockerfile',
        port: 8080,
        instanceType: 'standard-2',
        maxInstances: 10,
      });

      expect(manifest.spec.workers).toBeDefined();
      expect(manifest.spec.workers!['browser-host']).toEqual({
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

      expect(manifest.spec.routes).toHaveLength(1);
      expect(manifest.spec.routes![0]).toEqual({
        name: 'browser-api',
        target: 'browser-host',
        path: '/api',
      });
    });

    it('validates worker container references', () => {
      expect(() => parseAppManifestYaml(`
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
`)).toThrow(/references unknown container: nonexistent/);
    });

    it('validates route target references', () => {
      expect(() => parseAppManifestYaml(`
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
`)).toThrow(/references unknown worker, container, or service: nonexistent/);
    });

    it('requires name on routes', () => {
      expect(() => parseAppManifestYaml(`
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
`)).toThrow(/spec\.routes\[0\]\.name is required/);
    });

    it('parses env.inject with template variables', () => {
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

      expect(manifest.spec.env).toEqual({
        required: ['API_KEY'],
        inject: {
          BROWSER_URL: '{{workers.browser-host.url}}',
          ROUTE_URL: '{{routes.api.url}}',
        },
      });
    });

    it('rejects env.inject with invalid template references', () => {
      expect(() => parseAppManifestYaml(`
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
`)).toThrow(/template errors.*worker "nonexistent" not found/);
    });

    it('parses workers with bindings and triggers', () => {
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
    db:
      type: d1
      binding: DB
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
        d1: [db]
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
      expect(worker.env).toEqual({ NODE_ENV: 'production' });
      expect(worker.bindings).toEqual({
        d1: ['db'],
        queues: ['jobs'],
      });
      expect(worker.triggers).toEqual({
        schedules: [{ cron: '*/5 * * * *', export: 'handleCron' }],
        queues: [{ queue: 'jobs', export: 'handleJob' }],
      });
    });

    it('parses container env', () => {
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

      expect(manifest.spec.containers!.executor.env).toEqual({
        NODE_ENV: 'production',
        PORT: '8080',
      });
    });

    it('parses services with ipv4 and env', () => {
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

      expect(manifest.spec.services).toBeDefined();
      expect(manifest.spec.services!['my-api']).toEqual({
        dockerfile: 'Dockerfile',
        port: 3000,
        ipv4: true,
        env: { NODE_ENV: 'production' },
      });
    });

    it('allows routes to target services', () => {
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

      expect(manifest.spec.routes).toHaveLength(1);
      expect(manifest.spec.routes![0]).toEqual({
        name: 'api',
        target: 'my-api',
        path: '/api',
      });
    });

    it('emits services into bundle docs as type service', () => {
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

      expect(docs).toContainEqual(expect.objectContaining({
        kind: 'Workload',
        metadata: { name: 'my-api' },
        spec: expect.objectContaining({
          type: 'service',
          pluginConfig: {
            dockerfile: 'Dockerfile',
            port: 3000,
            ipv4: true,
          },
        }),
      }));
    });

    it('validates env.inject with services template references', () => {
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

      expect(manifest.spec.env).toEqual({
        inject: {
          API_IP: '{{services.my-api.ipv4}}',
          API_PORT: '{{services.my-api.port}}',
        },
      });
    });

    it('rejects env.inject referencing unknown service', () => {
      expect(() => parseAppManifestYaml(`
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
`)).toThrow(/template errors.*service "nonexistent" not found/);
    });
  });

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
  }): string {
    return `
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: test-app
spec:
  version: ${overrides.version ?? '1.0.0'}
${overrides.resources ? `  resources:\n${overrides.resources}` : ''}
${overrides.services ? `  services:\n${overrides.services}` : ''}
  workers:
${overrides.workers ?? `    web:${minWorkerYaml}`}
${overrides.lifecycle ? `  lifecycle:\n${overrides.lifecycle}` : ''}
${overrides.update ? `  update:\n${overrides.update}` : ''}
${overrides.takos ? `  takos:\n${overrides.takos}` : ''}
`;
  }

  // ============================================================
  // 1. Semver バリデーション
  // ============================================================

  describe('semver validation', () => {
    it('rejects invalid semver', () => {
      expect(() => parseAppManifestYaml(yaml({ version: 'banana' }))).toThrow(
        'spec.version must be valid semver',
      );
    });

    it('rejects v-prefixed version', () => {
      expect(() => parseAppManifestYaml(yaml({ version: 'v1.0.0' }))).toThrow(
        'spec.version must be valid semver',
      );
    });

    it('rejects incomplete semver', () => {
      expect(() => parseAppManifestYaml(yaml({ version: "'1.0'" }))).toThrow(
        'spec.version must be valid semver',
      );
    });

    it('accepts semver with prerelease', () => {
      const manifest = parseAppManifestYaml(yaml({ version: '1.0.0-beta.1' }));
      expect(manifest.spec.version).toBe('1.0.0-beta.1');
    });

    it('accepts semver with build metadata', () => {
      const manifest = parseAppManifestYaml(yaml({ version: '1.0.0+build.123' }));
      expect(manifest.spec.version).toBe('1.0.0+build.123');
    });

    it('accepts standard semver', () => {
      const manifest = parseAppManifestYaml(yaml({ version: '0.1.0' }));
      expect(manifest.spec.version).toBe('0.1.0');
    });
  });

  // ============================================================
  // 2. ヘルスチェック
  // ============================================================

  describe('healthCheck', () => {
    it('parses worker healthCheck', () => {
      const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      healthCheck:
        path: /health
        intervalSeconds: 30`,
      }));
      expect(manifest.spec.workers?.web.healthCheck?.path).toBe('/health');
      expect(manifest.spec.workers?.web.healthCheck?.intervalSeconds).toBe(30);
    });

    it('parses worker healthCheck with all fields', () => {
      const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      healthCheck:
        path: /healthz
        intervalSeconds: 15
        timeoutSeconds: 5
        unhealthyThreshold: 3`,
      }));
      expect(manifest.spec.workers?.web.healthCheck).toEqual({
        path: '/healthz',
        intervalSeconds: 15,
        timeoutSeconds: 5,
        unhealthyThreshold: 3,
      });
    });

    it('parses service healthCheck', () => {
      const manifest = parseAppManifestYaml(yaml({
        services: `    my-api:
      dockerfile: Dockerfile
      port: 3000
      healthCheck:
        path: /health
        intervalSeconds: 60`,
      }));
      expect(manifest.spec.services!['my-api'].healthCheck?.path).toBe('/health');
      expect(manifest.spec.services!['my-api'].healthCheck?.intervalSeconds).toBe(60);
    });
  });

  // ============================================================
  // 3. ライフサイクルフック
  // ============================================================

  describe('lifecycle hooks', () => {
    it('parses lifecycle hooks', () => {
      const manifest = parseAppManifestYaml(yaml({
        lifecycle: `    preApply:
      command: pnpm run migrate
      timeoutSeconds: 120
    postApply:
      command: pnpm run seed`,
      }));
      expect(manifest.spec.lifecycle?.preApply?.command).toBe('pnpm run migrate');
      expect(manifest.spec.lifecycle?.preApply?.timeoutSeconds).toBe(120);
      expect(manifest.spec.lifecycle?.postApply?.command).toBe('pnpm run seed');
      expect(manifest.spec.lifecycle?.postApply?.timeoutSeconds).toBeUndefined();
    });

    it('parses lifecycle with only preApply', () => {
      const manifest = parseAppManifestYaml(yaml({
        lifecycle: `    preApply:
      command: pnpm run migrate`,
      }));
      expect(manifest.spec.lifecycle?.preApply?.command).toBe('pnpm run migrate');
      expect(manifest.spec.lifecycle?.postApply).toBeUndefined();
    });

    it('omits lifecycle when not specified', () => {
      const manifest = parseAppManifestYaml(yaml({}));
      expect(manifest.spec.lifecycle).toBeUndefined();
    });
  });

  // ============================================================
  // 4. 依存バージョン制約 (service binding)
  // ============================================================

  describe('service binding version constraint', () => {
    it('parses service binding with version constraint', () => {
      const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        services:
          - name: other
            version: ">=2.0.0"`,
      }));
      const svc = manifest.spec.workers?.web.bindings?.services;
      expect(svc).toHaveLength(1);
      expect(svc![0]).toEqual({ name: 'other', version: '>=2.0.0' });
    });

    it('accepts plain string service bindings', () => {
      const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        services:
          - other-worker`,
      }));
      const svc = manifest.spec.workers?.web.bindings?.services;
      expect(svc).toEqual(['other-worker']);
    });

    it('accepts mixed string and object service bindings', () => {
      const manifest = parseAppManifestYaml(yaml({
        workers: `    web:${minWorkerYaml}
      bindings:
        services:
          - simple-svc
          - name: versioned-svc
            version: "^1.0.0"`,
      }));
      const svc = manifest.spec.workers?.web.bindings?.services;
      expect(svc).toHaveLength(2);
      expect(svc![0]).toBe('simple-svc');
      expect(svc![1]).toEqual({ name: 'versioned-svc', version: '^1.0.0' });
    });
  });

  // ============================================================
  // 5. プラットフォーム最小バージョン (takos.minVersion)
  // ============================================================

  describe('takos.minVersion', () => {
    it('parses takos.minVersion', () => {
      const manifest = parseAppManifestYaml(yaml({
        takos: `    scopes:
      - threads:read
    minVersion: '2.0.0'`,
      }));
      expect(manifest.spec.takos?.minVersion).toBe('2.0.0');
      expect(manifest.spec.takos?.scopes).toEqual(['threads:read']);
    });

    it('accepts takos without minVersion', () => {
      const manifest = parseAppManifestYaml(yaml({
        takos: `    scopes:
      - threads:read`,
      }));
      expect(manifest.spec.takos?.scopes).toEqual(['threads:read']);
      expect(manifest.spec.takos?.minVersion).toBeUndefined();
    });
  });

  // ============================================================
  // 6. ロールバック戦略 (update)
  // ============================================================

  describe('update strategy', () => {
    it('parses update strategy', () => {
      const manifest = parseAppManifestYaml(yaml({
        update: `    strategy: canary
    canaryWeight: 10
    rollbackOnFailure: true`,
      }));
      expect(manifest.spec.update?.strategy).toBe('canary');
      expect(manifest.spec.update?.canaryWeight).toBe(10);
      expect(manifest.spec.update?.rollbackOnFailure).toBe(true);
    });

    it('parses blue-green strategy', () => {
      const manifest = parseAppManifestYaml(yaml({
        update: `    strategy: blue-green
    timeoutSeconds: 300`,
      }));
      expect(manifest.spec.update?.strategy).toBe('blue-green');
      expect(manifest.spec.update?.timeoutSeconds).toBe(300);
    });

    it('parses rolling strategy', () => {
      const manifest = parseAppManifestYaml(yaml({
        update: `    strategy: rolling`,
      }));
      expect(manifest.spec.update?.strategy).toBe('rolling');
    });

    it('rejects invalid strategy', () => {
      expect(() =>
        parseAppManifestYaml(yaml({
          update: `    strategy: yolo`,
        })),
      ).toThrow('spec.update.strategy must be');
    });

    it('omits update when not specified', () => {
      const manifest = parseAppManifestYaml(yaml({}));
      expect(manifest.spec.update).toBeUndefined();
    });
  });

  // ============================================================
  // 7. マイグレーション拡張 (kv resources)
  // ============================================================

  describe('kv resource migrations', () => {
    it('allows migrations on kv resources', () => {
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
      expect(manifest.spec.resources?.cache.migrations).toBe('.takos/migrations/cache');
      expect(manifest.spec.resources?.cache.type).toBe('kv');
      expect(manifest.spec.resources?.cache.binding).toBe('CACHE');
    });

    it('allows migrations with up/down on kv resources', () => {
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
      expect(manifest.spec.resources?.cache.migrations).toEqual({
        up: '.takos/migrations/cache/up',
        down: '.takos/migrations/cache/down',
      });
    });
  });
});
