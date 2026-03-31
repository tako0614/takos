import { compileGroupDesiredState, materializeRoutes } from '@/services/deployment/group-state';
import { computeDiff } from '@/services/deployment/diff';

import { assertEquals, assertThrows, assertObjectMatch } from 'jsr:@std/assert';

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


  Deno.test('group desired state compiler - compiles a manifest into canonical workload/resource/route state', () => {
  const compiled = compileGroupDesiredState(makeManifest(), {
      groupName: 'demo-prod',
      provider: 'cloudflare',
      envName: 'production',
    });

    assertEquals(compiled.groupName, 'demo-prod');
    assertEquals(compiled.env, 'production');
    assertEquals(compiled.resources.db.bindingName, 'DB');
    assertEquals(compiled.resources.db.resourceClass, 'sql');
    assertEquals(compiled.resources.db.backing, 'd1');
    assertEquals(compiled.workloads.api.sourceKind, 'worker');
    assertEquals(compiled.workloads.api.executionProfile, 'workers');
    assertEquals(compiled.workloads.api.routeNames, ['api-route']);
    assertEquals((compiled.workloads.api.spec as { env?: Record<string, string> }).env?.MODE, 'prod');
    assertObjectMatch(compiled.routes['web-route'], { target: 'web', path: '/' });
})
  Deno.test('group desired state compiler - rejects duplicated component names across workload categories', () => {
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

    assertThrows(() => { () => compileGroupDesiredState(manifest as never); }, /Component names must be unique/);
})

  Deno.test('group diff - detects resource, workload, and route updates from canonical state', () => {
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

    assertEquals(diff.summary.update, 3);
    assertEquals(diff.entries, 
      ([
        ({ name: 'db', category: 'resource', action: 'update' }),
        ({ name: 'api', category: 'service', sourceKind: 'worker', action: 'update' }),
        ({ name: 'web-route', category: 'route', action: 'update' }),
      ]),
    );
})