import { compileGroupDesiredState } from '@/services/deployment/group-state';

import { assertEquals, assertObjectMatch } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  upsertHostnameRouting: ((..._args: any[]) => undefined) as any,
  deleteHostnameRouting: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/routing/service'
import { reconcileGroupRouting } from '@/services/deployment/group-routing';


  Deno.test('group routing reconciler - publishes hostname routing from canonical workloads and removes stale hostnames', async () => {
  const desired = compileGroupDesiredState({
      apiVersion: 'takos.dev/v1alpha1',
      kind: 'App',
      metadata: { name: 'demo-app' },
      spec: {
        version: '1.0.0',
        workers: {
          edge: {
            build: {
              fromWorkflow: {
                path: '.github/workflows/deploy.yml',
                job: 'build',
                artifact: 'edge',
                artifactPath: 'dist/edge.js',
              },
            },
          },
        },
        services: {
          api: {
            dockerfile: 'Dockerfile',
            port: 8080,
          },
        },
        routes: [
          {
            name: 'api',
            ingress: 'edge',
            target: 'api',
            path: '/api',
          },
        ],
      },
    } as const, {
      groupName: 'demo-app',
      provider: 'cloudflare',
      envName: 'production',
    });

    const result = await reconcileGroupRouting(
      {} as never,
      desired,
      {
        stale: {
          name: 'stale',
          target: 'edge',
          hostname: 'old.example.test',
          url: 'https://old.example.test/old',
        },
      },
      {
        edge: {
          serviceId: 'svc-edge',
          name: 'edge',
          sourceKind: 'worker',
          executionProfile: 'workers',
          artifactKind: 'worker-bundle',
          status: 'deployed',
          hostname: 'edge.example.test',
          routeRef: 'worker-edge',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
        api: {
          serviceId: 'svc-api',
          name: 'api',
          sourceKind: 'service',
          executionProfile: 'oci-service',
          artifactKind: 'container-image',
          status: 'deployed',
          hostname: 'api.example.test',
          routeRef: 'svc-api',
          resolvedBaseUrl: 'http://10.0.0.12:8080',
          updatedAt: '2026-03-29T00:00:00.000Z',
        },
      },
      '2026-03-29T12:00:00.000Z',
    );

    assertSpyCallArgs(mocks.upsertHostnameRouting, 0, [({
      hostname: 'edge.example.test',
      target: {
        type: 'http-endpoint-set',
        endpoints: [
          {
            name: 'api',
            routes: [{ pathPrefix: '/api' }],
            target: {
              kind: 'http-url',
              baseUrl: 'http://10.0.0.12:8080',
            },
          },
        ],
      },
    })]);
    assertSpyCallArgs(mocks.deleteHostnameRouting, 0, [({
      hostname: 'old.example.test',
    })]);
    assertEquals(result.failedRoutes, []);
    assertObjectMatch(result.routes.api, {
      hostname: 'edge.example.test',
      url: 'https://edge.example.test/api',
    });
    assertEquals(result.routes.stale, undefined);
})