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

  it('rejects non-worker services in current contract', () => {
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
`)).toThrow(/type must be worker/);
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
    expect(manifest.spec.services.api.bindings?.vectorize).toEqual(['semantic-index']);
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
    expect(manifest.spec.services.api.bindings).toMatchObject({
      queues: ['jobs'],
      analytics: ['events'],
      workflows: ['onboarding'],
    });
    expect(manifest.spec.services.api.triggers).toEqual({
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

});
