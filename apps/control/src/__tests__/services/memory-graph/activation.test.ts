import { describe, expect, it } from 'vitest';
import { buildActivationBundles, renderActivationSegment } from '@/services/memory-graph/activation';
import type { Claim, ClaimPath } from '@/services/memory-graph/types';

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

describe('buildActivationBundles', () => {
  it('builds bundles with evidence counts and paths', () => {
    const claims = [makeClaim({ id: 'c1' }), makeClaim({ id: 'c2', confidence: 0.7 })];
    const evidenceCounts = new Map([['c1', 3], ['c2', 1]]);
    const pathsByClaim = new Map([['c1', [makePath()]]]);

    const bundles = buildActivationBundles(claims, evidenceCounts, pathsByClaim);

    expect(bundles).toHaveLength(2);
    expect(bundles[0].evidenceCount).toBe(3);
    expect(bundles[0].paths).toHaveLength(1);
    expect(bundles[1].evidenceCount).toBe(1);
    expect(bundles[1].paths).toHaveLength(0);
  });

  it('handles empty inputs', () => {
    const bundles = buildActivationBundles([], new Map(), new Map());
    expect(bundles).toHaveLength(0);
  });
});

describe('renderActivationSegment', () => {
  it('returns empty result for no bundles', () => {
    const result = renderActivationSegment([]);
    expect(result.hasContent).toBe(false);
    expect(result.segment).toBe('');
  });

  it('renders claims sorted by confidence', () => {
    const bundles = buildActivationBundles(
      [
        makeClaim({ id: 'c1', confidence: 0.7, subject: 'Low' }),
        makeClaim({ id: 'c2', confidence: 0.95, subject: 'High' }),
      ],
      new Map([['c1', 1], ['c2', 2]]),
      new Map(),
    );

    const result = renderActivationSegment(bundles);

    expect(result.hasContent).toBe(true);
    expect(result.segment).toContain('[Active memory]');
    // High confidence should come first
    const highIdx = result.segment.indexOf('High');
    const lowIdx = result.segment.indexOf('Low');
    expect(highIdx).toBeLessThan(lowIdx);
  });

  it('includes known relations section when paths exist', () => {
    const bundles = buildActivationBundles(
      [makeClaim({ id: 'c1' })],
      new Map([['c1', 2]]),
      new Map([['c1', [makePath()]]]),
    );

    const result = renderActivationSegment(bundles);

    expect(result.segment).toContain('[Known relations]');
    expect(result.segment).toContain('hops');
  });

  it('respects max segment length', () => {
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
    expect(result.segment.length).toBeLessThanOrEqual(2000);
  });
});
