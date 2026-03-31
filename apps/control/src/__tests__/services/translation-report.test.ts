import {
  assertTranslationSupported,
  buildTranslationReport,
} from '@/services/deployment/translation-report';
import type { GroupDesiredState } from '@/services/deployment/group-state';

import { assertEquals, assertThrows, assertStringIncludes } from 'jsr:@std/assert';

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


  Deno.test('buildTranslationReport - maps cloudflare resources and workloads to native providers', () => {
  const report = buildTranslationReport(makeDesiredState('cloudflare'));

    assertEquals(report.resources, [
      ({
        name: 'db',
        publicType: 'd1',
        semanticType: 'sql',
        implementation: 'd1',
        driver: 'cloudflare-d1',
        status: 'native',
        resolutionMode: 'cloudflare-native',
        notes: ['Takos runtime realizes this Cloudflare-native resource directly on the Cloudflare backend.'],
      }),
      ({
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
    assertEquals(report.workloads, [
      ({
        name: 'api',
        provider: 'workers-dispatch',
        runtime: 'workers',
        status: 'native',
        notes: ['Takos runtime realizes worker workloads directly on the Cloudflare backend.'],
      }),
      ({
        name: 'web',
        provider: 'oci',
        runtime: 'container-service',
        status: 'portable',
        notes: ['Takos runtime on the Cloudflare backend uses the OCI deployment adapter for service/container workloads.'],
      }),
    ]);
    assertEquals(report.routes, [
      ({
        name: 'api-route',
        adapter: 'hostname-routing',
        status: 'native',
        notes: ['Takos runtime realizes routing directly through the Cloudflare hostname routing backend.'],
      }),
    ]);
    assertEquals(report.unsupported, []);
})
  Deno.test('buildTranslationReport - maps non-cloudflare resources and workloads to portable drivers', () => {
  const report = buildTranslationReport(makeDesiredState('aws'));

    assertEquals(report.resources, [
      ({
        name: 'db',
        driver: 'takos-sql',
        status: 'portable',
        implementation: 'd1',
        resolutionMode: 'provider-backed',
        provider: 'aws-backing-service',
        notes: ([
          'Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.',
        ]),
      }),
      ({
        name: 'bucket',
        driver: 'takos-object-store',
        status: 'portable',
        implementation: 'r2',
        resolutionMode: 'provider-backed',
        provider: 'aws-backing-service',
        notes: ([
          'Takos runtime on aws realizes this Cloudflare-native resource through a provider-backed adapter.',
        ]),
      }),
    ]);
    assertEquals(report.workloads, [
      ({ name: 'api', provider: 'runtime-host', status: 'portable' }),
      ({ name: 'web', provider: 'ecs', status: 'portable' }),
    ]);
    assertEquals(report.routes, [
      ({ name: 'api-route', adapter: 'ingress-routing', status: 'portable' }),
    ]);
    assertEquals(report.supported, true);
    assertEquals(report.unsupported, []);
})
  Deno.test('buildTranslationReport - marks portable resources as provider-backed or takos-runtime based on the resolved backend', () => {
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

    assertEquals(report.resources, ([
      ({ name: 'jobs', resolutionMode: 'provider-backed', provider: 'aws-backing-service', driver: 'takos-queue' }),
      ({ name: 'events', resolutionMode: 'takos-runtime', provider: 'takos-runtime', driver: 'takos-analytics-store' }),
      ({ name: 'flow', resolutionMode: 'takos-runtime', provider: 'takos-runtime', driver: 'takos-workflow-runtime' }),
      ({ name: 'counter', resolutionMode: 'takos-runtime', provider: 'takos-runtime', driver: 'takos-durable-runtime' }),
      ({ name: 'secret', resolutionMode: 'provider-backed', provider: 'aws-backing-service', driver: 'takos-secret' }),
    ]));
})
  Deno.test('buildTranslationReport - uses workload-level image provider when specified', () => {
  const report = buildTranslationReport(makeDesiredState('cloudflare', {
      webImageRef: 'ghcr.io/example/web:latest',
      webProvider: 'k8s',
    }));

    assertEquals(report.workloads, [
      ({ name: 'api', category: 'worker', provider: 'workers-dispatch', status: 'native' }),
      ({ name: 'web', provider: 'k8s', runtime: 'container-service', requirements: ['OCI_ORCHESTRATOR_URL'] }),
    ]);
    assertEquals(report.supported, false);
    assertStringIncludes(report.requirements, 'OCI_ORCHESTRATOR_URL');
})
  Deno.test('buildTranslationReport - requires OCI orchestrator URL before assertion when image workloads exist', () => {
  const report = buildTranslationReport(makeDesiredState('cloudflare', {
      webImageRef: 'ghcr.io/example/web:latest',
      webProvider: 'oci',
    }));

    assertEquals(report.supported, false);
    assertEquals(report.unsupported, []);
    assertThrows(() => { () => assertTranslationSupported(report, {}); }, 'OCI_ORCHESTRATOR_URL is required');
    try { () => assertTranslationSupported(report, { ociOrchestratorUrl: 'http://orchestrator.internal' }); } catch (_e) { throw new Error('Expected no throw'); };
})