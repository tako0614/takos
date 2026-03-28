import { describe, expect, it } from 'vitest';
import {
  appManifestToBundleDocs,
  extractBuildSourcesFromManifestJson,
  parseAppManifestYaml,
} from '@/services/source/app-manifest';

describe('app manifest service', () => {
  it('rejects legacy local build fields', () => {
    expect(() => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-app
spec:
  version: 1.0.0
  services:
    api:
      type: worker
      build:
        command: pnpm build
        output: dist/api.mjs
`)).toThrow(/local build fields are not supported/);
  });

  it('rejects unsupported service types', () => {
    expect(() => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: broken-app
spec:
  version: 1.0.0
  services:
    api:
      type: http
      baseUrl: https://example.internal
`)).toThrow(/type must be worker or container/);
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
  services:
    api:
      type: worker
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
    const apiService = manifest.spec.services!.api;
    expect(apiService.type).toBe('worker');
    if (apiService.type === 'worker') {
      expect(apiService.bindings?.vectorize).toEqual(['semantic-index']);
    }
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
  services:
    api:
      type: worker
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
    const apiService = manifest.spec.services!.api;
    expect(apiService.type).toBe('worker');
    if (apiService.type === 'worker') {
      expect(apiService.bindings).toMatchObject({
        queues: ['jobs'],
        analytics: ['events'],
        workflows: ['onboarding'],
      });
      expect(apiService.triggers).toEqual({
        schedules: [{ cron: '*/5 * * * *', export: 'handleCron' }],
        queues: [{ queue: 'jobs', export: 'handleJob' }],
      });
    }
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
  services:
    api:
      type: worker
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

  it('parses worker service with containers', () => {
    const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: container-app
spec:
  version: 1.0.0
  services:
    browser-host:
      type: worker
      containers:
        - name: browser
          dockerfile: packages/browser-service/Dockerfile
          port: 8080
          instanceType: standard-2
          maxInstances: 25
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-browser-host
          artifact: browser-host
          artifactPath: dist/browser-host.js
`);

    const svc = manifest.spec.services!['browser-host'];
    expect(svc.type).toBe('worker');
    if (svc.type === 'worker') {
      expect(svc.containers).toHaveLength(1);
      expect(svc.containers![0]).toEqual({
        name: 'browser',
        dockerfile: 'packages/browser-service/Dockerfile',
        port: 8080,
        instanceType: 'standard-2',
        maxInstances: 25,
      });
    }
  });

  it('parses persistent container service', () => {
    const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: vps-app
spec:
  version: 1.0.0
  services:
    my-api:
      type: container
      container:
        dockerfile: Dockerfile
        port: 3000
`);

    const svc = manifest.spec.services!['my-api'];
    expect(svc.type).toBe('container');
    if (svc.type === 'container') {
      expect(svc.container).toEqual({
        dockerfile: 'Dockerfile',
        port: 3000,
      });
    }
  });

  it('emits worker containers into bundle docs', () => {
    const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: container-app
spec:
  version: 1.0.0
  services:
    browser-host:
      type: worker
      containers:
        - name: browser
          dockerfile: packages/browser-service/Dockerfile
          port: 8080
          instanceType: standard-2
          maxInstances: 25
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
  services:
    api:
      type: worker
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
  // New format: containers + workers + routes
  // ============================================================

  describe('new format (containers + workers)', () => {
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
      ipv4: true
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
        ipv4: true,
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

      // services should not be set in new format
      expect(manifest.spec.services).toBeUndefined();
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
`)).toThrow(/references unknown worker or container: nonexistent/);
    });

    it('requires name on routes in new format', () => {
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

    it('rejects mixed services and workers', () => {
      expect(() => parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: mixed-app
spec:
  version: 1.0.0
  services:
    api:
      type: worker
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
  workers:
    api2:
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build
          artifact: dist
          artifactPath: dist/api.js
`)).toThrow(/mutually exclusive/);
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
  });

  // ============================================================
  // Legacy format backward compatibility
  // ============================================================

  describe('legacy format backward compatibility', () => {
    it('still parses services format correctly', () => {
      const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: legacy-app
spec:
  version: 1.0.0
  services:
    api:
      type: worker
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
  routes:
    - name: main
      service: api
      path: /
`);

      expect(manifest.spec.services).toBeDefined();
      expect(manifest.spec.services!.api.type).toBe('worker');
      // Legacy routes get normalized to new AppRoute shape with target
      expect(manifest.spec.routes).toHaveLength(1);
      expect(manifest.spec.routes![0].target).toBe('api');
      expect(manifest.spec.routes![0].name).toBe('main');
      // workers/containers should not be set
      expect(manifest.spec.workers).toBeUndefined();
      expect(manifest.spec.containers).toBeUndefined();
    });

    it('assigns route name from service when name omitted in legacy format', () => {
      const manifest = parseAppManifestYaml(`
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: legacy-app
spec:
  version: 1.0.0
  services:
    api:
      type: worker
      build:
        fromWorkflow:
          path: .takos/workflows/build.yml
          job: build-api
          artifact: api-dist
          artifactPath: dist/api.mjs
  routes:
    - service: api
      path: /api
`);

      expect(manifest.spec.routes![0].name).toBe('api');
      expect(manifest.spec.routes![0].target).toBe('api');
    });
  });

});
