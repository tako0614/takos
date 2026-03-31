import {
  parseRoutingValue,
  selectHttpEndpointFromHttpEndpointSet,
  selectRouteRefFromHttpEndpointSet,
  selectRouteRefFromRoutingTarget,
} from '@/services/routing/service';
import type { StoredHttpEndpoint } from '@/services/routing/types';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('selectRouteRefFromRoutingTarget - selects a deployment candidate by weight', () => {
  const target = {
      type: 'deployments' as const,
      deployments: [
        { routeRef: 'worker-a', weight: 80 },
        { routeRef: 'worker-b', weight: 20 },
      ],
    };

    assertEquals(selectRouteRefFromRoutingTarget(target, { random: () => 0.1 }), 'worker-a');
    assertEquals(selectRouteRefFromRoutingTarget(target, { random: () => 0.95 }), 'worker-b');
})

  Deno.test('parseRoutingValue - fails closed for legacy plain-string routing values', () => {
  const parsed = parseRoutingValue('worker-legacy');
    assertEquals(parsed.target, null);
    assertEquals(parsed.rawFormat, 'unknown');
})
  Deno.test('parseRoutingValue - fails closed for legacy workerName envelopes', () => {
  const parsed = parseRoutingValue(JSON.stringify({ workerName: 'worker-legacy' }));
    assertEquals(parsed.target, null);
    assertEquals(parsed.rawFormat, 'unknown');
})

  const cfEndpoint = (name: string, routeRef: string, routes: StoredHttpEndpoint['routes']): StoredHttpEndpoint => ({
    name,
    routes,
    target: { kind: 'service-ref', ref: routeRef },
  });

  Deno.test('selectRouteRefFromHttpEndpointSet - returns null for empty endpoint list', () => {
  assertEquals(selectRouteRefFromHttpEndpointSet([], '/api', 'GET'), null);
})
  Deno.test('selectRouteRefFromHttpEndpointSet - matches match-all endpoint (empty routes)', () => {
  const endpoints = [cfEndpoint('all', 'worker-a', [])];
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/anything', 'GET'), 'worker-a');
})
  Deno.test('selectRouteRefFromHttpEndpointSet - matches endpoint with pathPrefix', () => {
  const endpoints = [
      cfEndpoint('api', 'worker-api', [{ pathPrefix: '/api' }]),
      cfEndpoint('all', 'worker-all', []),
    ];
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/api/users', 'GET'), 'worker-api');
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/other', 'GET'), 'worker-all');
})
  Deno.test('selectRouteRefFromHttpEndpointSet - uses longest prefix match', () => {
  const endpoints = [
      cfEndpoint('api', 'worker-api', [{ pathPrefix: '/api' }]),
      cfEndpoint('api-v2', 'worker-v2', [{ pathPrefix: '/api/v2' }]),
    ];
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/api/v2/users', 'GET'), 'worker-v2');
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/api/v1/users', 'GET'), 'worker-api');
})
  Deno.test('selectRouteRefFromHttpEndpointSet - respects method filter', () => {
  const endpoints = [
      cfEndpoint('write', 'worker-write', [{ pathPrefix: '/data', methods: ['POST', 'PUT'] }]),
      cfEndpoint('read', 'worker-read', [{ pathPrefix: '/data', methods: ['GET'] }]),
    ];
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/data', 'GET'), 'worker-read');
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/data', 'POST'), 'worker-write');
})
  Deno.test('selectRouteRefFromHttpEndpointSet - returns null when no route matches', () => {
  const endpoints = [cfEndpoint('api', 'worker-api', [{ pathPrefix: '/api' }])];
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/other', 'GET'), null);
})
  Deno.test('selectRouteRefFromHttpEndpointSet - returns null for http-url targets', () => {
  const endpoints: StoredHttpEndpoint[] = [
      {
        name: 'ec2',
        routes: [],
        target: { kind: 'http-url', baseUrl: 'https://ec2.example.test' },
      },
    ];
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/any', 'GET'), null);
})
  Deno.test('selectRouteRefFromHttpEndpointSet - returns matching http.url endpoints for direct forwarding', () => {
  const endpoints: StoredHttpEndpoint[] = [
      {
        name: 'oci-public',
        routes: [{ pathPrefix: '/api' }],
        target: { kind: 'http-url', baseUrl: 'https://worker.example.test/base/' },
      },
    ];
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/api/test', 'GET'), null);
    assertEquals(selectHttpEndpointFromHttpEndpointSet(endpoints, '/api/test', 'GET'), endpoints[0]);
})
  Deno.test('selectRouteRefFromHttpEndpointSet - match-all only wins if no longer prefix match exists', () => {
  const endpoints = [
      cfEndpoint('fallback', 'worker-fallback', []),
      cfEndpoint('specific', 'worker-specific', [{ pathPrefix: '/api' }]),
    ];
    // Order: fallback first, specific second
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/api/test', 'GET'), 'worker-specific');
    assertEquals(selectRouteRefFromHttpEndpointSet(endpoints, '/home', 'GET'), 'worker-fallback');
})