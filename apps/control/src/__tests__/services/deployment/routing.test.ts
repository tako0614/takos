import { collectHostnames, buildRoutingTarget } from '@/services/deployment/routing';


import { assertEquals, assertThrows, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('collectHostnames - returns empty array when no hostnames', () => {
  const result = collectHostnames({ hostname: null, customDomains: [] });
    assertEquals(result, []);
})
  Deno.test('collectHostnames - includes the worker hostname', () => {
  const result = collectHostnames({ hostname: 'my-worker.example.com', customDomains: [] });
    assertEquals(result, ['my-worker.example.com']);
})
  Deno.test('collectHostnames - includes custom domains', () => {
  const result = collectHostnames({
      hostname: null,
      customDomains: [
        { domain: 'custom1.com' },
        { domain: 'custom2.com' },
      ],
    });
    assertEquals(result, ['custom1.com', 'custom2.com']);
})
  Deno.test('collectHostnames - combines worker hostname and custom domains', () => {
  const result = collectHostnames({
      hostname: 'worker.example.com',
      customDomains: [{ domain: 'custom.com' }],
    });
    assertStringIncludes(result, 'worker.example.com');
    assertStringIncludes(result, 'custom.com');
    assertEquals(result.length, 2);
})
  Deno.test('collectHostnames - deduplicates hostnames (case insensitive)', () => {
  const result = collectHostnames({
      hostname: 'Worker.Example.Com',
      customDomains: [{ domain: 'worker.example.com' }],
    });
    assertEquals(result.length, 1);
    assertEquals(result[0], 'worker.example.com');
})
  Deno.test('collectHostnames - skips null custom domains', () => {
  const result = collectHostnames({
      hostname: 'worker.example.com',
      customDomains: [{ domain: null }, { domain: 'custom.com' }],
    });
    assertEquals(result.length, 2);
    assertStringIncludes(result, 'worker.example.com');
    assertStringIncludes(result, 'custom.com');
})
  Deno.test('collectHostnames - lowercases all hostnames', () => {
  const result = collectHostnames({
      hostname: 'UPPER.EXAMPLE.COM',
      customDomains: [{ domain: 'MiXeD.CaSe.COM' }],
    });
    assertEquals(result, ['upper.example.com', 'mixed.case.com']);
})

  const baseServiceRouteRecord = {
    id: 'w-1',
    hostname: 'test.example.com',
    activeDeploymentId: 'dep-prev',
    customDomains: [],
  };

  Deno.test('buildRoutingTarget - builds active deployment routing target', () => {
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

    assertEquals(result.target.type, 'deployments');
    if (result.target.type === 'deployments') {
      assertEquals(result.target.deployments.length, 1);
      assertEquals(result.target.deployments[0].weight, 100);
      assertEquals(result.target.deployments[0].status, 'active');
      assertEquals(result.target.deployments[0].routeRef, 'worker-w-1-v2');
    }
    assertEquals(result.auditDetails.mode, 'active');
})
  Deno.test('buildRoutingTarget - builds rollback deployment routing target', () => {
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
      assertEquals(result.target.deployments[0].status, 'rollback');
    }
    assertEquals(result.auditDetails.mode, 'rollback');
})
  Deno.test('buildRoutingTarget - builds canary deployment routing target with active+canary split', () => {
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
      assertEquals(result.target.deployments.length, 2);
      const activeSlot = result.target.deployments.find((d) => d.status === 'active');
      const canarySlot = result.target.deployments.find((d) => d.status === 'canary');
      assertEquals(activeSlot?.weight, 90);
      assertEquals(canarySlot?.weight, 10);
    }
    assertEquals(result.auditDetails.mode, 'canary');
})
  Deno.test('buildRoutingTarget - normalizes canary weight to integer between 1 and 99', () => {
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
      assertEquals(canarySlot?.weight, 99);
    }
})
  Deno.test('buildRoutingTarget - throws when canary is requested but active route ref is missing', () => {
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

    assertThrows(() => { () => buildRoutingTarget(ctx, ['test.example.com']); }, 'Active deployment route ref is missing');
})
  Deno.test('buildRoutingTarget - throws when deployment route ref is missing for non-http-url target', () => {
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

    assertThrows(() => { () => buildRoutingTarget(ctx, ['test.example.com']); }, 'Deployment route ref is missing');
})
  Deno.test('buildRoutingTarget - builds http-url routing target', () => {
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

    assertEquals(result.target.type, 'http-endpoint-set');
    assertEquals(result.auditDetails.mode, 'http-url');
})
  Deno.test('buildRoutingTarget - throws when canary requested for http-url target', () => {
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

    assertThrows(() => { () => buildRoutingTarget(ctx, ['test.example.com']); }, 'http-url deployment targets do not support canary routing');
})