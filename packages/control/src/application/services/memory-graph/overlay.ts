import type { Claim, Evidence, ClaimInsert, EvidenceInsert } from './types';

const MAX_OVERLAY_CLAIMS = 200;
const MAX_EVIDENCE_CONTENT = 2048;

export class RunOverlay {
  private claims = new Map<string, Claim>();
  private evidence: Evidence[] = [];

  addClaim(insert: ClaimInsert): Claim {
    if (this.claims.size >= MAX_OVERLAY_CLAIMS) {
      const lowest = [...this.claims.values()].reduce((a, b) =>
        a.confidence < b.confidence ? a : b,
      );
      this.claims.delete(lowest.id);
    }

    const now = new Date().toISOString();
    const claim: Claim = {
      id: insert.id,
      accountId: insert.accountId,
      claimType: insert.claimType,
      subject: insert.subject,
      predicate: insert.predicate,
      object: insert.object,
      confidence: insert.confidence ?? 0.5,
      status: insert.status ?? 'active',
      supersededBy: insert.supersededBy ?? null,
      sourceRunId: insert.sourceRunId ?? null,
      createdAt: now,
      updatedAt: now,
    };

    this.claims.set(claim.id, claim);
    return claim;
  }

  addEvidence(insert: EvidenceInsert): Evidence {
    const now = new Date().toISOString();
    const evidence: Evidence = {
      id: insert.id,
      accountId: insert.accountId,
      claimId: insert.claimId,
      kind: insert.kind,
      sourceType: insert.sourceType,
      sourceRef: insert.sourceRef ?? null,
      content: insert.content.slice(0, MAX_EVIDENCE_CONTENT),
      trust: insert.trust ?? 0.7,
      taint: insert.taint ?? null,
      createdAt: now,
    };

    this.evidence.push(evidence);
    return evidence;
  }

  getClaim(id: string): Claim | undefined {
    return this.claims.get(id);
  }

  findClaimsBySubject(subject: string): Claim[] {
    const lower = subject.toLowerCase();
    return [...this.claims.values()].filter(
      c => c.subject.toLowerCase().includes(lower),
    );
  }

  searchClaims(query: string): Claim[] {
    const lower = query.toLowerCase();
    return [...this.claims.values()].filter(c =>
      c.subject.toLowerCase().includes(lower) ||
      c.predicate.toLowerCase().includes(lower) ||
      c.object.toLowerCase().includes(lower),
    );
  }

  getAllClaims(): Claim[] {
    return [...this.claims.values()];
  }

  getAllEvidence(): Evidence[] {
    return [...this.evidence];
  }

  getEvidenceForClaim(claimId: string): Evidence[] {
    return this.evidence.filter(e => e.claimId === claimId);
  }

  get claimCount(): number {
    return this.claims.size;
  }

  get evidenceCount(): number {
    return this.evidence.length;
  }

  clear(): void {
    this.claims.clear();
    this.evidence = [];
  }
}
