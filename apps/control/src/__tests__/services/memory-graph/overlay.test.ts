import { RunOverlay } from '@/services/memory-graph/overlay';


import { assertEquals, assert } from 'jsr:@std/assert';

  let overlay: RunOverlay;
  Deno.test('RunOverlay - adds and retrieves a claim', () => {
  overlay = new RunOverlay();
  const claim = overlay.addClaim({
      id: 'c1',
      accountId: 'acct1',
      claimType: 'fact',
      subject: 'TypeScript',
      predicate: 'is',
      object: 'preferred language',
      confidence: 0.9,
    });

    assertEquals(claim.id, 'c1');
    assertEquals(claim.confidence, 0.9);
    assert(overlay.getClaim('c1') !== undefined);
    assertEquals(overlay.claimCount, 1);
})
  Deno.test('RunOverlay - adds and retrieves evidence', () => {
  overlay = new RunOverlay();
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

    assertEquals(ev.id, 'e1');
    assertEquals(overlay.getEvidenceForClaim('c1').length, 1);
    assertEquals(overlay.evidenceCount, 1);
})
  Deno.test('RunOverlay - truncates evidence content to 2KB', () => {
  overlay = new RunOverlay();
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

    assertEquals(ev.content.length, 2048);
})
  Deno.test('RunOverlay - evicts lowest-confidence claim when at capacity', () => {
  overlay = new RunOverlay();
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
    assertEquals(overlay.claimCount, 200);

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

    assertEquals(overlay.claimCount, 200);
    assertEquals(overlay.getClaim('c0'), undefined); // evicted
    assert(overlay.getClaim('c_new') !== undefined);
})
  Deno.test('RunOverlay - searches claims by subject/predicate/object', () => {
  overlay = new RunOverlay();
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

    assertEquals(overlay.searchClaims('React').length, 1);
    assertEquals(overlay.searchClaims('frontend').length, 2);
    assertEquals(overlay.searchClaims('nonexistent').length, 0);
})
  Deno.test('RunOverlay - clears all data', () => {
  overlay = new RunOverlay();
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
    assertEquals(overlay.claimCount, 0);
    assertEquals(overlay.evidenceCount, 0);
})