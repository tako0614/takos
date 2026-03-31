import { buildActivationBundles, renderActivationSegment } from '@/services/memory-graph/activation';
import type { Claim, ClaimPath } from '@/services/memory-graph/types';

import { assertEquals, assert, assertStringIncludes } from 'jsr:@std/assert';

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    accountId: 'acct1',
    claimType: 'fact',
    subject: 'TypeScript',
    predicate: 'is',
    object: 'preferred language',
    confidence: 0.9,
    status: 'active',
    supersededBy: null,
    sourceRunId: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makePath(overrides: Partial<ClaimPath> = {}): ClaimPath {
  return {
    id: 'p1',
    accountId: 'acct1',
    startClaimId: 'c1',
    endClaimId: 'c2',
    hopCount: 1,
    pathClaims: ['c1', 'c2'],
    pathRelations: ['supports'],
    pathSummary: null,
    minConfidence: 0.85,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}


  Deno.test('buildActivationBundles - builds bundles with evidence counts and paths', () => {
  const claims = [makeClaim({ id: 'c1' }), makeClaim({ id: 'c2', confidence: 0.7 })];
    const evidenceCounts = new Map([['c1', 3], ['c2', 1]]);
    const pathsByClaim = new Map([['c1', [makePath()]]]);

    const bundles = buildActivationBundles(claims, evidenceCounts, pathsByClaim);

    assertEquals(bundles.length, 2);
    assertEquals(bundles[0].evidenceCount, 3);
    assertEquals(bundles[0].paths.length, 1);
    assertEquals(bundles[1].evidenceCount, 1);
    assertEquals(bundles[1].paths.length, 0);
})
  Deno.test('buildActivationBundles - handles empty inputs', () => {
  const bundles = buildActivationBundles([], new Map(), new Map());
    assertEquals(bundles.length, 0);
})

  Deno.test('renderActivationSegment - returns empty result for no bundles', () => {
  const result = renderActivationSegment([]);
    assertEquals(result.hasContent, false);
    assertEquals(result.segment, '');
})
  Deno.test('renderActivationSegment - renders claims sorted by confidence', () => {
  const bundles = buildActivationBundles(
      [
        makeClaim({ id: 'c1', confidence: 0.7, subject: 'Low' }),
        makeClaim({ id: 'c2', confidence: 0.95, subject: 'High' }),
      ],
      new Map([['c1', 1], ['c2', 2]]),
      new Map(),
    );

    const result = renderActivationSegment(bundles);

    assertEquals(result.hasContent, true);
    assertStringIncludes(result.segment, '[Active memory]');
    // High confidence should come first
    const highIdx = result.segment.indexOf('High');
    const lowIdx = result.segment.indexOf('Low');
    assert(highIdx < lowIdx);
})
  Deno.test('renderActivationSegment - includes known relations section when paths exist', () => {
  const bundles = buildActivationBundles(
      [makeClaim({ id: 'c1' })],
      new Map([['c1', 2]]),
      new Map([['c1', [makePath()]]]),
    );

    const result = renderActivationSegment(bundles);

    assertStringIncludes(result.segment, '[Known relations]');
    assertStringIncludes(result.segment, 'hops');
})
  Deno.test('renderActivationSegment - respects max segment length', () => {
  // Create many claims
    const claims = Array.from({ length: 100 }, (_, i) =>
      makeClaim({
        id: `c${i}`,
        confidence: 0.5 + i * 0.001,
        subject: `Subject${i}`,
        object: `A long description for object ${i} that takes up space`,
      }),
    );
    const bundles = buildActivationBundles(claims, new Map(), new Map());

    const result = renderActivationSegment(bundles);
    assert(result.segment.length <= 2000);
})