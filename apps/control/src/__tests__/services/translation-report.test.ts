import { describe, expect, it } from 'vitest';
import {
  assertTranslationSupported,
  buildTranslationReport,
} from '@/services/deployment/translation-report';
import type { GroupDesiredState } from '@/services/deployment/group-state';

function makeDesiredState(
  provider: string,
  options?: {
    webImageRef?: string;
    webProvider?: 'oci' | 'ecs' | 'cloud-run' | 'k8s';
  },
): GroupDesiredState {
  const normalizedProvider = options?.webProvider;
  const hasImageRef = typeof options?.webImageRef === 'string' && options.webImageRef.trim().length > 0;

  const webSpec = hasImageRef
    ? {
      ...(normalizedProvider ? { provider: normalizedProvider, artifact: { kind: 'image', imageRef: options.webImageRef! } } : { imageRef: options.webImageRef! }),
      imageRef: options.webImageRef,
      port: 8080,
      provider: normalizedProvider,
    }
    : {};

  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'GroupDesiredState',
    groupName: 'demo',
    version: '1.0.0',
    provider,
    env: 'production',
    manifest: {
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'AppManifest',
      metadata: { name: 'demo' },
      spec: { version: '1.0.0' },
    } as never,
    resources: {
      db: {
        name: 'db',
        type: 'd1',
        spec: { type: 'd1' } as never,
        specFingerprint: 'db',
      },
      bucket: {
        name: 'bucket',
        type: 'r2',
        spec: { type: 'r2' } as never,
        specFingerprint: 'bucket',
      },
    },
    workloads: {
      api: {
        name: 'api',
        category: 'worker',
        spec: {} as never,
        specFingerprint: 'api',
        dependsOn: [],
        routeNames: ['api-route'],
      },
      web: {
        name: 'web',
        category: 'service',
        spec: webSpec as never,
        specFingerprint: 'web',
        dependsOn: [],
        routeNames: [],
      },
    },
    routes: {
      'api-route': {
        name: 'api-route',
        target: 'api',
      },
    },
  };
}

describe('buildTranslationReport', () => {
  it('maps cloudflare resources and workloads to native providers', () => {
    const report = buildTranslationReport(makeDesiredState('cloudflare'));

    expect(report.resources).toEqual([
      expect.objectContaining({
        name: 'db',
        publicType: 'd1',
        semanticType: 'sql',
        implementation: 'd1',
        driver: 'cloudflare-d1',
        status: 'native',
        resolutionMode: 'cloudflare-native',
        notes: ['Takos runtime realizes this Cloudflare-native resource directly on the Cloudflare backend.'],
      }),
      expect.objectContaining({
        name: 'bucket',
        publicType: 'r2',
        semanticType: 'object_store',
        implementation: 'r2',
        driver: 'cloudflare-r2',
        status: 'native',
        resolutionMode: 'cloudflare-native',
        notes: ['Takos runtime realizes this Cloudflare-native resource directly on the Cloudflare backend.'],
      }),
    ]);
    expect(report.workloads).toEqual([
      expect.objectContaining({
        name: 'api',
        provider: 'workers-dispatch',
        runtime: 'workers',
        status: 'native',
        notes: ['Takos runtime realizes worker workloads directly on the Cloudflare backend.'],
      }),
      expect.objectContaining({
        name: 'web',
        provider: 'oci',
        runtime: 'container-service',
        status: 'portable',
        notes: ['Takos runtime on the Cloudflare backend uses the OCI deployment adapter for service/container workloads.'],
      }),
    ]);
    expect(report.routes).toEqual([
      expect.objectContaining({
        name: 'api-route',
        adapter: 'hostname-routing',
        status: 'native',
        notes: ['Takos runtime realizes routing directly through the Cloudflare hostname routing backend.'],
      }),
    ]);
    expect(report.unsupported).toEqual([]);
  });

  it('maps non-cloudflare resources and workloads to portable drivers', () => {
    const report = buildTranslationReport(makeDesiredState('aws'));

    expect(report.resources).toEqual([
      expect.objectContaining({
        name: 'db',
        driver: 'takos-sql',
        status: 'portable',
        implementation: 'd1',
        resolutionMode: 'provider-backed',
        provider: 'aws-backing-service',
        notes: expect.arrayContaining([
          'Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.',
        ]),
      }),
      expect.objectContaining({
        name: 'bucket',
        driver: 'takos-object-store',
        status: 'portable',
        implementation: 'r2',
        resolutionMode: 'provider-backed',
        provider: 'aws-backing-service',
        notes: expect.arrayContaining([
          'Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.',
        ]),
      }),
    ]);
    expect(report.workloads).toEqual([
      expect.objectContaining({ name: 'api', provider: 'runtime-host', status: 'portable' }),
      expect.objectContaining({ name: 'web', provider: 'ecs', status: 'portable' }),
    ]);
    expect(report.routes).toEqual([
      expect.objectContaining({ name: 'api-route', adapter: 'ingress-routing', status: 'portable' }),
    ]);
    expect(report.supported).toBe(true);
    expect(report.unsupported).toEqual([]);
  });

  it('marks portable resources as provider-backed or takos-runtime based on the resolved backend', () => {
    const desiredState = makeDesiredState('aws');
    desiredState.resources.jobs = {
      name: 'jobs',
      type: 'queue',
      spec: { type: 'queue' } as never,
      specFingerprint: 'jobs',
    };
    desiredState.resources.events = {
      name: 'events',
      type: 'analyticsEngine',
      spec: { type: 'analyticsEngine' } as never,
      specFingerprint: 'events',
    };
    desiredState.resources.flow = {
      name: 'flow',
      type: 'workflow',
      spec: { type: 'workflow' } as never,
      specFingerprint: 'flow',
    };
    desiredState.resources.counter = {
      name: 'counter',
      type: 'durableObject',
      spec: { type: 'durableObject' } as never,
      specFingerprint: 'counter',
    };
    desiredState.resources.secret = {
      name: 'secret',
      type: 'secretRef',
      spec: { type: 'secretRef' } as never,
      specFingerprint: 'secret',
    };

    const report = buildTranslationReport(desiredState);

    expect(report.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'jobs', resolutionMode: 'provider-backed', provider: 'aws-backing-service', driver: 'takos-queue' }),
      expect.objectContaining({ name: 'events', resolutionMode: 'takos-runtime', provider: 'takos-runtime', driver: 'takos-analytics-store' }),
      expect.objectContaining({ name: 'flow', resolutionMode: 'takos-runtime', provider: 'takos-runtime', driver: 'takos-workflow-runtime' }),
      expect.objectContaining({ name: 'counter', resolutionMode: 'takos-runtime', provider: 'takos-runtime', driver: 'takos-durable-runtime' }),
      expect.objectContaining({ name: 'secret', resolutionMode: 'provider-backed', provider: 'aws-backing-service', driver: 'takos-secret' }),
    ]));
  });

  it('uses workload-level image provider when specified', () => {
    const report = buildTranslationReport(makeDesiredState('cloudflare', {
      webImageRef: 'ghcr.io/example/web:latest',
      webProvider: 'k8s',
    }));

    expect(report.workloads).toEqual([
      expect.objectContaining({ name: 'api', category: 'worker', provider: 'workers-dispatch', status: 'native' }),
      expect.objectContaining({ name: 'web', provider: 'k8s', runtime: 'container-service', requirements: ['OCI_ORCHESTRATOR_URL'] }),
    ]);
    expect(report.supported).toBe(false);
    expect(report.requirements).toContain('OCI_ORCHESTRATOR_URL');
  });

  it('requires OCI orchestrator URL before assertion when image workloads exist', () => {
    const report = buildTranslationReport(makeDesiredState('cloudflare', {
      webImageRef: 'ghcr.io/example/web:latest',
      webProvider: 'oci',
    }));

    expect(report.supported).toBe(false);
    expect(report.unsupported).toEqual([]);
    expect(() => assertTranslationSupported(report, {})).toThrow('OCI_ORCHESTRATOR_URL is required');
    expect(() => assertTranslationSupported(report, { ociOrchestratorUrl: 'http://orchestrator.internal' })).not.toThrow();
  });
});
