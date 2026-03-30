import { describe, expect, it, vi } from 'vitest';
import { compileGroupDesiredState } from '@/services/deployment/group-state';

const mocks = vi.hoisted(() => ({
  upsertHostnameRouting: vi.fn(),
  deleteHostnameRouting: vi.fn(),
}));

vi.mock('@/services/routing/service', () => ({
  upsertHostnameRouting: mocks.upsertHostnameRouting,
  deleteHostnameRouting: mocks.deleteHostnameRouting,
}));

import { reconcileGroupRouting } from '@/services/deployment/group-routing';

describe('group routing reconciler', () => {
  it('publishes hostname routing from canonical workloads and removes stale hostnames', async () => {
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

    expect(mocks.upsertHostnameRouting).toHaveBeenCalledWith(expect.objectContaining({
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
    }));
    expect(mocks.deleteHostnameRouting).toHaveBeenCalledWith(expect.objectContaining({
      hostname: 'old.example.test',
    }));
    expect(result.failedRoutes).toEqual([]);
    expect(result.routes.api).toMatchObject({
      hostname: 'edge.example.test',
      url: 'https://edge.example.test/api',
    });
    expect(result.routes.stale).toBeUndefined();
  });
});
