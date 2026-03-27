import { describe, expect, it } from 'vitest';
import {
  parseRoutingValue,
  selectHttpEndpointFromHttpEndpointSet,
  selectRouteRefFromHttpEndpointSet,
  selectRouteRefFromRoutingTarget,
} from '@/services/routing/service';
import type { StoredHttpEndpoint } from '@/services/routing/types';

describe('selectRouteRefFromRoutingTarget', () => {
  it('selects a deployment candidate by weight', () => {
    const target = {
      type: 'deployments' as const,
      deployments: [
        { routeRef: 'worker-a', weight: 80 },
        { routeRef: 'worker-b', weight: 20 },
      ],
    };

    expect(selectRouteRefFromRoutingTarget(target, { random: () => 0.1 })).toBe('worker-a');
    expect(selectRouteRefFromRoutingTarget(target, { random: () => 0.95 })).toBe('worker-b');
  });
});

describe('parseRoutingValue', () => {
  it('fails closed for legacy plain-string routing values', () => {
    const parsed = parseRoutingValue('worker-legacy');
    expect(parsed.target).toBeNull();
    expect(parsed.rawFormat).toBe('unknown');
  });

  it('fails closed for legacy workerName envelopes', () => {
    const parsed = parseRoutingValue(JSON.stringify({ workerName: 'worker-legacy' }));
    expect(parsed.target).toBeNull();
    expect(parsed.rawFormat).toBe('unknown');
  });
});

describe('selectRouteRefFromHttpEndpointSet', () => {
  const cfEndpoint = (name: string, routeRef: string, routes: StoredHttpEndpoint['routes']): StoredHttpEndpoint => ({
    name,
    routes,
    target: { kind: 'service-ref', ref: routeRef },
  });

  it('returns null for empty endpoint list', () => {
    expect(selectRouteRefFromHttpEndpointSet([], '/api', 'GET')).toBeNull();
  });

  it('matches match-all endpoint (empty routes)', () => {
    const endpoints = [cfEndpoint('all', 'worker-a', [])];
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/anything', 'GET')).toBe('worker-a');
  });

  it('matches endpoint with pathPrefix', () => {
    const endpoints = [
      cfEndpoint('api', 'worker-api', [{ pathPrefix: '/api' }]),
      cfEndpoint('all', 'worker-all', []),
    ];
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/api/users', 'GET')).toBe('worker-api');
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/other', 'GET')).toBe('worker-all');
  });

  it('uses longest prefix match', () => {
    const endpoints = [
      cfEndpoint('api', 'worker-api', [{ pathPrefix: '/api' }]),
      cfEndpoint('api-v2', 'worker-v2', [{ pathPrefix: '/api/v2' }]),
    ];
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/api/v2/users', 'GET')).toBe('worker-v2');
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/api/v1/users', 'GET')).toBe('worker-api');
  });

  it('respects method filter', () => {
    const endpoints = [
      cfEndpoint('write', 'worker-write', [{ pathPrefix: '/data', methods: ['POST', 'PUT'] }]),
      cfEndpoint('read', 'worker-read', [{ pathPrefix: '/data', methods: ['GET'] }]),
    ];
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/data', 'GET')).toBe('worker-read');
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/data', 'POST')).toBe('worker-write');
  });

  it('returns null when no route matches', () => {
    const endpoints = [cfEndpoint('api', 'worker-api', [{ pathPrefix: '/api' }])];
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/other', 'GET')).toBeNull();
  });

  it('returns null for http-url targets', () => {
    const endpoints: StoredHttpEndpoint[] = [
      {
        name: 'ec2',
        routes: [],
        target: { kind: 'http-url', baseUrl: 'https://ec2.example.test' },
      },
    ];
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/any', 'GET')).toBeNull();
  });

  it('returns matching http.url endpoints for direct forwarding', () => {
    const endpoints: StoredHttpEndpoint[] = [
      {
        name: 'oci-public',
        routes: [{ pathPrefix: '/api' }],
        target: { kind: 'http-url', baseUrl: 'https://worker.example.test/base/' },
      },
    ];
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/api/test', 'GET')).toBeNull();
    expect(selectHttpEndpointFromHttpEndpointSet(endpoints, '/api/test', 'GET')).toEqual(endpoints[0]);
  });

  it('match-all only wins if no longer prefix match exists', () => {
    const endpoints = [
      cfEndpoint('fallback', 'worker-fallback', []),
      cfEndpoint('specific', 'worker-specific', [{ pathPrefix: '/api' }]),
    ];
    // Order: fallback first, specific second
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/api/test', 'GET')).toBe('worker-specific');
    expect(selectRouteRefFromHttpEndpointSet(endpoints, '/home', 'GET')).toBe('worker-fallback');
  });
});
