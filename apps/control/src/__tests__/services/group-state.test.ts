import { describe, expect, it } from 'vitest';
import { compileGroupDesiredState, materializeRoutes } from '@/services/deployment/group-state';
import { computeDiff } from '@/services/deployment/diff';

function makeManifest() {
  return {
    apiVersion: 'takos.dev/v1alpha1',
    kind: 'App',
    metadata: { name: 'demo-app' },
    spec: {
      version: '1.0.0',
      resources: {
        db: { type: 'sql', binding: 'DB' },
      },
      workers: {
        api: {
          build: {
            fromWorkflow: {
              path: '.github/workflows/deploy.yml',
              job: 'build',
              artifact: 'worker',
              artifactPath: 'dist/worker.js',
            },
          },
          env: { MODE: 'base' },
        },
      },
      services: {
        web: {
          dockerfile: 'Dockerfile',
          port: 8080,
        },
      },
      routes: [
        { name: 'api-route', target: 'api', path: '/api' },
        { name: 'web-route', target: 'web', path: '/' },
      ],
      overrides: {
        production: {
          workers: {
            api: {
              env: { MODE: 'prod' },
            },
          },
        },
      },
    },
  } as const;
}

describe('group desired state compiler', () => {
  it('compiles a manifest into canonical workload/resource/route state', () => {
    const compiled = compileGroupDesiredState(makeManifest(), {
      groupName: 'demo-prod',
      provider: 'cloudflare',
      envName: 'production',
    });

    expect(compiled.groupName).toBe('demo-prod');
    expect(compiled.env).toBe('production');
    expect(compiled.resources.db.bindingName).toBe('DB');
    expect(compiled.resources.db.resourceClass).toBe('sql');
    expect(compiled.resources.db.backing).toBe('d1');
    expect(compiled.workloads.api.sourceKind).toBe('worker');
    expect(compiled.workloads.api.executionProfile).toBe('workers');
    expect(compiled.workloads.api.routeNames).toEqual(['api-route']);
    expect((compiled.workloads.api.spec as { env?: Record<string, string> }).env?.MODE).toBe('prod');
    expect(compiled.routes['web-route']).toMatchObject({ target: 'web', path: '/' });
  });

  it('rejects duplicated component names across workload categories', () => {
    const manifest = {
      ...makeManifest(),
      spec: {
        ...makeManifest().spec,
        containers: {
          api: {
            dockerfile: 'Dockerfile.container',
            port: 9000,
          },
        },
      },
    };

    expect(() => compileGroupDesiredState(manifest as never)).toThrow(/Component names must be unique/);
  });
});

describe('group diff', () => {
  it('detects resource, workload, and route updates from canonical state', () => {
    const desired = compileGroupDesiredState(makeManifest(), {
      groupName: 'demo-prod',
      provider: 'cloudflare',
      envName: 'production',
    });
    const currentRoutes = materializeRoutes(desired.routes, {
      api: {
        serviceId: 'svc-api',
        name: 'api',
        sourceKind: 'worker',
        executionProfile: 'workers',
        artifactKind: 'worker-bundle',
        status: 'deployed',
        hostname: 'api.example.test',
        routeRef: 'worker-api',
        specFingerprint: 'stale-worker',
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
      web: {
        serviceId: 'svc-web',
        name: 'web',
        sourceKind: 'service',
        executionProfile: 'oci-service',
        artifactKind: 'container-image',
        status: 'deployed',
        hostname: 'web.example.test',
        specFingerprint: desired.workloads.web.specFingerprint,
        updatedAt: '2026-03-29T00:00:00.000Z',
      },
    });

    const diff = computeDiff(desired, {
      groupId: 'group-1',
      groupName: 'demo-prod',
      provider: 'cloudflare',
      env: 'production',
      version: '0.9.0',
      updatedAt: '2026-03-29T00:00:00.000Z',
      resources: {
        db: {
          name: 'db',
          manifestType: 'sql',
          resourceClass: 'sql',
          backing: 'd1',
          resourceId: 'db-1',
          bindingName: 'OLD_DB',
          bindingType: 'sql',
          status: 'active',
          specFingerprint: 'stale-resource',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
      },
      workloads: {
        api: {
          serviceId: 'svc-api',
          name: 'api',
          sourceKind: 'worker',
          executionProfile: 'workers',
          artifactKind: 'worker-bundle',
          status: 'deployed',
          hostname: 'api.example.test',
          routeRef: 'worker-api',
          specFingerprint: 'stale-worker',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        web: {
          serviceId: 'svc-web',
          name: 'web',
          sourceKind: 'service',
          executionProfile: 'oci-service',
          artifactKind: 'container-image',
          status: 'deployed',
          hostname: 'web.example.test',
          specFingerprint: desired.workloads.web.specFingerprint,
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
      },
      routes: {
        ...currentRoutes,
        'web-route': {
          ...currentRoutes['web-route'],
          path: '/stale',
        },
      },
    });

    expect(diff.summary.update).toBe(3);
    expect(diff.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'db', category: 'resource', action: 'update' }),
        expect.objectContaining({ name: 'api', category: 'service', sourceKind: 'worker', action: 'update' }),
        expect.objectContaining({ name: 'web-route', category: 'route', action: 'update' }),
      ]),
    );
  });
});
