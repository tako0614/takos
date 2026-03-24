export type ClaimType = 'fact' | 'preference' | 'decision' | 'observation';
export type ClaimStatus = 'active' | 'superseded' | 'retracted';

export interface Claim {
  id: string;
  accountId: string;
  claimType: ClaimType;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: ClaimStatus;
  supersededBy: string | null;
  sourceRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClaimInsert {
  id: string;
  accountId: string;
  claimType: ClaimType;
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  status?: ClaimStatus;
  supersededBy?: string | null;
  sourceRunId?: string | null;
}

export type EvidenceKind = 'supports' | 'contradicts' | 'context';
export type EvidenceSourceType = 'tool_result' | 'user_message' | 'agent_inference' | 'memory_recall';

export interface Evidence {
  id: string;
  accountId: string;
  claimId: string;
  kind: EvidenceKind;
  sourceType: EvidenceSourceType;
  sourceRef: string | null;
  content: string;
  trust: number;
  taint: string | null;
  createdAt: string;
}

export interface EvidenceInsert {
  id: string;
  accountId: string;
  claimId: string;
  kind: EvidenceKind;
  sourceType: EvidenceSourceType;
  sourceRef?: string | null;
  content: string;
  trust?: number;
  taint?: string | null;
}

export type ClaimRelation = 'depends_on' | 'contradicts' | 'supports' | 'supersedes' | 'related_to';

export interface ClaimEdge {
  id: string;
  accountId: string;
  sourceClaimId: string;
  targetClaimId: string;
  relation: ClaimRelation;
  weight: number;
  createdAt: string;
}

export interface ClaimEdgeInsert {
  id: string;
  accountId: string;
  sourceClaimId: string;
  targetClaimId: string;
  relation: ClaimRelation;
  weight?: number;
}

export interface ClaimPath {
  id: string;
  accountId: string;
  startClaimId: string;
  endClaimId: string;
  hopCount: number;
  pathClaims: string[];
  pathRelations: string[];
  pathSummary: string | null;
  minConfidence: number;
  createdAt: string;
}

export interface ActivationBundle {
  claim: Claim;
  evidenceCount: number;
  paths: ClaimPath[];
}

export interface ActivationResult {
  bundles: ActivationBundle[];
  segment: string;
  hasContent: boolean;
}

export interface ToolObservation {
  toolName: string;
  arguments: Record<string, unknown>;
  result: string;
  error?: string;
  timestamp: number;
  duration?: number;
}

export interface ToolObserver {
  observe(record: ToolObservation): void;
  getOverlayClaims(): Claim[];
  getOverlayEvidence(): Evidence[];
}
