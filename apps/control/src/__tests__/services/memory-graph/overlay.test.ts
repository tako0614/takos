import { describe, expect, it, beforeEach } from 'vitest';
import { RunOverlay } from '@/services/memory-graph/overlay';

describe('RunOverlay', () => {
  let overlay: RunOverlay;

  beforeEach(() => {
    overlay = new RunOverlay();
  });

  it('adds and retrieves a claim', () => {
    const claim = overlay.addClaim({
      id: 'c1',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'TypeScript',
      predicate: 'is',
      object: 'preferred language',
      confidence: 0.9,
    });

    expect(claim.id).toBe('c1');
    expect(claim.confidence).toBe(0.9);
    expect(overlay.getClaim('c1')).toBeDefined();
    expect(overlay.claimCount).toBe(1);
  });

  it('adds and retrieves evidence', () => {
    overlay.addClaim({
      id: 'c1',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'TypeScript',
      predicate: 'is',
      object: 'preferred',
    });

    const ev = overlay.addEvidence({
      id: 'e1',
      accountId: 'acct1',
      claimId: 'c1',
      kind: 'supports',
      sourceType: 'tool_result',
      content: 'User stated preference',
      trust: 0.9,
    });

    expect(ev.id).toBe('e1');
    expect(overlay.getEvidenceForClaim('c1')).toHaveLength(1);
    expect(overlay.evidenceCount).toBe(1);
  });

  it('truncates evidence content to 2KB', () => {
    overlay.addClaim({
      id: 'c1',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'x',
      predicate: 'is',
      object: 'y',
    });

    const longContent = 'a'.repeat(5000);
    const ev = overlay.addEvidence({
      id: 'e1',
      accountId: 'acct1',
      claimId: 'c1',
      kind: 'supports',
      sourceType: 'tool_result',
      content: longContent,
    });

    expect(ev.content.length).toBe(2048);
  });

  it('evicts lowest-confidence claim when at capacity', () => {
    // Fill to max (200)
    for (let i = 0; i < 200; i++) {
      overlay.addClaim({
        id: `c${i}`,
        accountId: 'acct1',
        claimType: 'fact',
        subject: `s${i}`,
        predicate: 'is',
        object: `o${i}`,
        confidence: i === 0 ? 0.01 : 0.5, // first one has lowest confidence
      });
    }
    expect(overlay.claimCount).toBe(200);

    // Add one more — should evict the lowest confidence
    overlay.addClaim({
      id: 'c_new',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'new',
      predicate: 'is',
      object: 'claim',
      confidence: 0.8,
    });

    expect(overlay.claimCount).toBe(200);
    expect(overlay.getClaim('c0')).toBeUndefined(); // evicted
    expect(overlay.getClaim('c_new')).toBeDefined();
  });

  it('searches claims by subject/predicate/object', () => {
    overlay.addClaim({
      id: 'c1',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'React',
      predicate: 'is',
      object: 'frontend framework',
    });
    overlay.addClaim({
      id: 'c2',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'Vue',
      predicate: 'is',
      object: 'frontend framework',
    });

    expect(overlay.searchClaims('React')).toHaveLength(1);
    expect(overlay.searchClaims('frontend')).toHaveLength(2);
    expect(overlay.searchClaims('nonexistent')).toHaveLength(0);
  });

  it('clears all data', () => {
    overlay.addClaim({
      id: 'c1',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'x',
      predicate: 'is',
      object: 'y',
    });
    overlay.addEvidence({
      id: 'e1',
      accountId: 'acct1',
      claimId: 'c1',
      kind: 'supports',
      sourceType: 'tool_result',
      content: 'test',
    });

    overlay.clear();
    expect(overlay.claimCount).toBe(0);
    expect(overlay.evidenceCount).toBe(0);
  });
});
