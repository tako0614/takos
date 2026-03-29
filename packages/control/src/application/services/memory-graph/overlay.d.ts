import type { Claim, Evidence, ClaimInsert, EvidenceInsert } from './graph-models';
export declare class RunOverlay {
    private claims;
    private evidence;
    addClaim(insert: ClaimInsert): Claim;
    addEvidence(insert: EvidenceInsert): Evidence;
    getClaim(id: string): Claim | undefined;
    findClaimsBySubject(subject: string): Claim[];
    searchClaims(query: string): Claim[];
    getAllClaims(): Claim[];
    getAllEvidence(): Evidence[];
    getEvidenceForClaim(claimId: string): Evidence[];
    get claimCount(): number;
    get evidenceCount(): number;
    clear(): void;
}
//# sourceMappingURL=overlay.d.ts.map