import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Claim, ClaimInsert, Evidence, EvidenceInsert, ClaimEdge, ClaimEdgeInsert, ClaimPath, ClaimStatus } from './graph-models';
export declare function insertClaim(db: D1Database, claim: ClaimInsert): Promise<void>;
export declare function upsertClaim(db: D1Database, claim: ClaimInsert): Promise<void>;
export declare function getActiveClaims(db: D1Database, accountId: string, limit?: number): Promise<Claim[]>;
export declare function searchClaims(db: D1Database, accountId: string, query: string, limit?: number): Promise<Claim[]>;
export declare function updateClaimStatus(db: D1Database, claimId: string, status: ClaimStatus, supersededBy?: string): Promise<void>;
export declare function insertEvidence(db: D1Database, evidence: EvidenceInsert): Promise<void>;
export declare function getEvidenceForClaim(db: D1Database, claimId: string, limit?: number): Promise<Evidence[]>;
export declare function countEvidenceForClaims(db: D1Database, claimIds: string[]): Promise<Map<string, number>>;
export declare function insertEdge(db: D1Database, edge: ClaimEdgeInsert): Promise<void>;
export declare function getEdgesFrom(db: D1Database, claimId: string): Promise<ClaimEdge[]>;
export declare function getEdgesTo(db: D1Database, claimId: string): Promise<ClaimEdge[]>;
export declare function insertPath(db: D1Database, path: ClaimPath): Promise<void>;
export declare function getPathsForClaim(db: D1Database, accountId: string, claimId: string, limit?: number): Promise<ClaimPath[]>;
export declare function deletePathsForAccount(db: D1Database, accountId: string): Promise<void>;
export declare function countPathsForAccount(db: D1Database, accountId: string): Promise<number>;
//# sourceMappingURL=claim-store.d.ts.map