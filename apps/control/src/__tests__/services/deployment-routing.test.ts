import { describe, expect, it } from 'vitest';
import { buildRoutingTarget } from '@/services/deployment/routing';

describe('deployment routing', () => {
  const serviceRouteRecord = {
    id: 'worker-1',
    hostname: 'tenant.example.test',
    activeDeploymentId: 'dep-current',
    customDomains: [],
  };

  it('builds an http-endpoint-set for generic http-url targets', () => {
    const result = buildRoutingTarget({
      deploymentId: 'dep-oci',
      deploymentVersion: 2,
      deployArtifactRef: 'artifact-oci',
      deploymentTarget: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test/base/',
        },
      },
      serviceRouteRecord,
      desiredRoutingStatus: 'active',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    }, ['tenant.example.test']);

    expect(result.target).toEqual({
      type: 'http-endpoint-set',
      endpoints: [
          {
            name: 'takos-worker',
            routes: [],
            target: {
              kind: 'http-url',
              baseUrl: 'https://worker.example.test/base/',
            },
          },
      ],
    });
  });

  it('uses route_ref for service-ref deployment routing', () => {
    const result = buildRoutingTarget({
      deploymentId: 'dep-oci',
      deploymentVersion: 2,
      deployArtifactRef: 'artifact-oci',
      deploymentTarget: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'service-ref',
          ref: 'takos-worker',
        },
      },
      serviceRouteRecord,
      desiredRoutingStatus: 'active',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    }, ['tenant.example.test']);

    expect(result.target).toEqual({
      type: 'deployments',
      deployments: [
        {
          routeRef: 'takos-worker',
          weight: 100,
          deploymentId: 'dep-oci',
          status: 'active',
        },
      ],
    });
  });

  it('uses rollback status for generic service-ref rollback routing', () => {
    const result = buildRoutingTarget({
      deploymentId: 'dep-oci',
      deploymentVersion: 2,
      deployArtifactRef: 'artifact-oci',
      deploymentTarget: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'service-ref',
          ref: 'takos-worker',
        },
      },
      serviceRouteRecord,
      desiredRoutingStatus: 'rollback',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    }, ['tenant.example.test']);

    expect(result.target).toEqual({
      type: 'deployments',
      deployments: [
        {
          routeRef: 'takos-worker',
          weight: 100,
          deploymentId: 'dep-oci',
          status: 'rollback',
        },
      ],
    });
    expect(result.auditDetails.mode).toBe('rollback');
  });

  it('keeps http-url rollback routing on http-endpoint-set', () => {
    const result = buildRoutingTarget({
      deploymentId: 'dep-oci',
      deploymentVersion: 2,
      deployArtifactRef: 'artifact-oci',
      deploymentTarget: {
        route_ref: 'takos-worker',
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test/base/',
        },
      },
      serviceRouteRecord,
      desiredRoutingStatus: 'rollback',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    }, ['tenant.example.test']);

    expect(result.target).toEqual({
      type: 'http-endpoint-set',
      endpoints: [
          {
            name: 'takos-worker',
            routes: [],
            target: {
              kind: 'http-url',
              baseUrl: 'https://worker.example.test/base/',
            },
          },
      ],
    });
    expect(result.auditDetails.mode).toBe('http-url');
  });

  it('rejects canary routing for http-url targets', () => {
    expect(() => buildRoutingTarget({
      deploymentId: 'dep-oci',
      deploymentVersion: 2,
      deployArtifactRef: 'artifact-oci',
      deploymentTarget: {
        endpoint: {
          kind: 'http-url',
          base_url: 'https://worker.example.test/base/',
        },
      },
      serviceRouteRecord,
      desiredRoutingStatus: 'canary',
      desiredRoutingWeight: 10,
      activeDeployment: {
        id: 'dep-current',
        artifactRef: 'worker-current',
        targetJson: JSON.stringify({
          route_ref: 'worker-current',
          endpoint: {
            kind: 'service-ref',
            ref: 'worker-current',
          },
        }),
        routingStatus: 'active',
      },
    }, ['tenant.example.test'])).toThrow('http-url deployment targets do not support canary routing');
  });
});
