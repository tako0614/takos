import { describe, it, expect, vi } from 'vitest';
import { collectHostnames, buildRoutingTarget } from '@/services/deployment/routing';

describe('collectHostnames', () => {
  it('returns empty array when no hostnames', () => {
    const result = collectHostnames({ hostname: null, customDomains: [] });
    expect(result).toEqual([]);
  });

  it('includes the worker hostname', () => {
    const result = collectHostnames({ hostname: 'my-worker.example.com', customDomains: [] });
    expect(result).toEqual(['my-worker.example.com']);
  });

  it('includes custom domains', () => {
    const result = collectHostnames({
      hostname: null,
      customDomains: [
        { domain: 'custom1.com' },
        { domain: 'custom2.com' },
      ],
    });
    expect(result).toEqual(['custom1.com', 'custom2.com']);
  });

  it('combines worker hostname and custom domains', () => {
    const result = collectHostnames({
      hostname: 'worker.example.com',
      customDomains: [{ domain: 'custom.com' }],
    });
    expect(result).toContain('worker.example.com');
    expect(result).toContain('custom.com');
    expect(result).toHaveLength(2);
  });

  it('deduplicates hostnames (case insensitive)', () => {
    const result = collectHostnames({
      hostname: 'Worker.Example.Com',
      customDomains: [{ domain: 'worker.example.com' }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('worker.example.com');
  });

  it('skips null custom domains', () => {
    const result = collectHostnames({
      hostname: 'worker.example.com',
      customDomains: [{ domain: null }, { domain: 'custom.com' }],
    });
    expect(result).toHaveLength(2);
    expect(result).toContain('worker.example.com');
    expect(result).toContain('custom.com');
  });

  it('lowercases all hostnames', () => {
    const result = collectHostnames({
      hostname: 'UPPER.EXAMPLE.COM',
      customDomains: [{ domain: 'MiXeD.CaSe.COM' }],
    });
    expect(result).toEqual(['upper.example.com', 'mixed.case.com']);
  });
});

describe('buildRoutingTarget', () => {
  const baseServiceRouteRecord = {
    id: 'w-1',
    hostname: 'test.example.com',
    activeDeploymentId: 'dep-prev',
    customDomains: [],
  };

  it('builds active deployment routing target', () => {
    const ctx = {
      deploymentId: 'dep-1',
      deploymentVersion: 2,
      deployArtifactRef: 'worker-w-1-v2',
      deploymentTarget: { route_ref: 'worker-w-1-v2' },
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'active',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    };

    const result = buildRoutingTarget(ctx, ['test.example.com']);

    expect(result.target.type).toBe('deployments');
    if (result.target.type === 'deployments') {
      expect(result.target.deployments).toHaveLength(1);
      expect(result.target.deployments[0].weight).toBe(100);
      expect(result.target.deployments[0].status).toBe('active');
      expect(result.target.deployments[0].routeRef).toBe('worker-w-1-v2');
    }
    expect(result.auditDetails.mode).toBe('active');
  });

  it('builds rollback deployment routing target', () => {
    const ctx = {
      deploymentId: 'dep-1',
      deploymentVersion: 1,
      deployArtifactRef: 'worker-w-1-v1',
      deploymentTarget: { route_ref: 'worker-w-1-v1' },
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'rollback',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    };

    const result = buildRoutingTarget(ctx, ['test.example.com']);

    if (result.target.type === 'deployments') {
      expect(result.target.deployments[0].status).toBe('rollback');
    }
    expect(result.auditDetails.mode).toBe('rollback');
  });

  it('builds canary deployment routing target with active+canary split', () => {
    const ctx = {
      deploymentId: 'dep-2',
      deploymentVersion: 2,
      deployArtifactRef: 'worker-w-1-v2',
      deploymentTarget: { route_ref: 'worker-w-1-v2' },
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'canary',
      desiredRoutingWeight: 10,
      activeDeployment: {
        id: 'dep-1',
        artifactRef: 'worker-w-1-v1',
        targetJson: '{"route_ref":"worker-w-1-v1"}',
        routingStatus: 'active',
      },
    };

    const result = buildRoutingTarget(ctx, ['test.example.com']);

    if (result.target.type === 'deployments') {
      expect(result.target.deployments).toHaveLength(2);
      const activeSlot = result.target.deployments.find((d) => d.status === 'active');
      const canarySlot = result.target.deployments.find((d) => d.status === 'canary');
      expect(activeSlot?.weight).toBe(90);
      expect(canarySlot?.weight).toBe(10);
    }
    expect(result.auditDetails.mode).toBe('canary');
  });

  it('normalizes canary weight to integer between 1 and 99', () => {
    const ctx = {
      deploymentId: 'dep-2',
      deploymentVersion: 2,
      deployArtifactRef: 'worker-w-1-v2',
      deploymentTarget: { route_ref: 'worker-w-1-v2' },
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'canary',
      desiredRoutingWeight: 150,
      activeDeployment: {
        id: 'dep-1',
        artifactRef: 'worker-w-1-v1',
        targetJson: '{"route_ref":"worker-w-1-v1"}',
        routingStatus: 'active',
      },
    };

    const result = buildRoutingTarget(ctx, ['test.example.com']);

    if (result.target.type === 'deployments') {
      const canarySlot = result.target.deployments.find((d) => d.status === 'canary');
      expect(canarySlot?.weight).toBe(99);
    }
  });

  it('throws when canary is requested but active route ref is missing', () => {
    const ctx = {
      deploymentId: 'dep-2',
      deploymentVersion: 2,
      deployArtifactRef: 'worker-w-1-v2',
      deploymentTarget: { route_ref: 'worker-w-1-v2' },
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'canary',
      desiredRoutingWeight: 10,
      activeDeployment: {
        id: 'dep-1',
        artifactRef: null,
        targetJson: '{}',
        routingStatus: 'active',
      },
    };

    expect(() => buildRoutingTarget(ctx, ['test.example.com'])).toThrow('Active deployment route ref is missing');
  });

  it('throws when deployment route ref is missing for non-http-url target', () => {
    const ctx = {
      deploymentId: 'dep-1',
      deploymentVersion: 1,
      deployArtifactRef: '',
      deploymentTarget: {},
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'active',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    };

    expect(() => buildRoutingTarget(ctx, ['test.example.com'])).toThrow('Deployment route ref is missing');
  });

  it('builds http-url routing target', () => {
    const ctx = {
      deploymentId: 'dep-1',
      deploymentVersion: 1,
      deployArtifactRef: 'worker-w-1-v1',
      deploymentTarget: {
        route_ref: 'my-external',
        endpoint: {
          kind: 'http-url' as const,
          base_url: 'https://external.example.com',
        },
      },
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'active',
      desiredRoutingWeight: 100,
      activeDeployment: null,
    };

    const result = buildRoutingTarget(ctx, ['test.example.com']);

    expect(result.target.type).toBe('http-endpoint-set');
    expect(result.auditDetails.mode).toBe('http-url');
  });

  it('throws when canary requested for http-url target', () => {
    const ctx = {
      deploymentId: 'dep-1',
      deploymentVersion: 1,
      deployArtifactRef: 'worker-w-1-v1',
      deploymentTarget: {
        endpoint: {
          kind: 'http-url' as const,
          base_url: 'https://external.example.com',
        },
      },
      serviceRouteRecord: baseServiceRouteRecord,
      desiredRoutingStatus: 'canary',
      desiredRoutingWeight: 10,
      activeDeployment: null,
    };

    expect(() => buildRoutingTarget(ctx, ['test.example.com'])).toThrow('http-url deployment targets do not support canary routing');
  });
});
