import { describe, expect, it } from 'vitest';
import { buildTranslationReport } from '@/services/deployment/translation-report';
import type { GroupDesiredState } from '@/services/deployment/group-state';

function makeDesiredState(provider: string): GroupDesiredState {
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
        spec: {} as never,
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
      expect.objectContaining({ name: 'db', publicType: 'd1', semanticType: 'sql', implementation: 'd1', driver: 'cloudflare-d1', status: 'native' }),
      expect.objectContaining({ name: 'bucket', publicType: 'r2', semanticType: 'object_store', implementation: 'r2', driver: 'cloudflare-r2', status: 'native' }),
    ]);
    expect(report.workloads).toEqual([
      expect.objectContaining({ name: 'api', provider: 'workers-dispatch', runtime: 'workers', status: 'native' }),
      expect.objectContaining({ name: 'web', provider: 'oci', runtime: 'container-service', status: 'portable' }),
    ]);
    expect(report.routes).toEqual([
      expect.objectContaining({ name: 'api-route', adapter: 'hostname-routing', status: 'native' }),
    ]);
    expect(report.unsupported).toEqual([]);
  });

  it('maps non-cloudflare resources and workloads to portable drivers', () => {
    const report = buildTranslationReport(makeDesiredState('aws'));

    expect(report.resources).toEqual([
      expect.objectContaining({ name: 'db', driver: 'takos-sql', status: 'planned', implementation: 'd1' }),
      expect.objectContaining({ name: 'bucket', driver: 'takos-object-store', status: 'planned', implementation: 'r2' }),
    ]);
    expect(report.workloads).toEqual([
      expect.objectContaining({ name: 'api', provider: 'runtime-host', status: 'portable' }),
      expect.objectContaining({ name: 'web', provider: 'ecs', status: 'portable' }),
    ]);
    expect(report.routes).toEqual([
      expect.objectContaining({ name: 'api-route', adapter: 'ingress-routing', status: 'portable' }),
    ]);
    expect(report.supported).toBe(false);
    expect(report.unsupported).toEqual([
      expect.objectContaining({ category: 'resource', name: 'db' }),
      expect.objectContaining({ category: 'resource', name: 'bucket' }),
    ]);
  });
});
