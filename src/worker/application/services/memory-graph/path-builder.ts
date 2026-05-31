import { MAX_ACTIVE_CLAIMS } from "../../../shared/config/limits.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { generateId } from "../../../shared/utils/index.ts";
import type { Claim, ClaimEdge } from "./graph-models.ts";
import {
  deletePathsForAccount,
  getActiveClaims,
  getActiveClaimsByRun,
  getEdgesForAccount,
  insertPath,
} from "./claim-store.ts";

const MAX_PATH_BUILD_CLAIMS = MAX_ACTIVE_CLAIMS * 2;
const MAX_PATH_BUILD_EDGES = 1000;
const MAX_PATH_HOPS = 3;
const MAX_MATERIALIZED_PATHS = 500;

export interface BuildMemoryPathsOptions {
  accountId: string;
  sourceRunId?: string;
  maxClaims?: number;
  maxEdges?: number;
  maxHops?: number;
  maxPaths?: number;
}

export interface BuildMemoryPathsResult {
  claimCount: number;
  edgeCount: number;
  sourceRunClaimCount: number;
  insertedPathCount: number;
}

interface PathCandidate {
  startClaimId: string;
  endClaimId: string;
  pathClaims: string[];
  pathRelations: string[];
  minConfidence: number;
}

export async function buildMemoryPaths(
  db: SqlDatabaseBinding,
  options: BuildMemoryPathsOptions,
): Promise<BuildMemoryPathsResult> {
  const maxClaims = options.maxClaims ?? MAX_PATH_BUILD_CLAIMS;
  const maxEdges = options.maxEdges ?? MAX_PATH_BUILD_EDGES;
  const maxHops = options.maxHops ?? MAX_PATH_HOPS;
  const maxPaths = options.maxPaths ?? MAX_MATERIALIZED_PATHS;

  const [activeClaims, sourceRunClaims] = await Promise.all([
    getActiveClaims(db, options.accountId, maxClaims),
    options.sourceRunId
      ? getActiveClaimsByRun(
        db,
        options.accountId,
        options.sourceRunId,
        maxClaims,
      )
      : Promise.resolve([]),
  ]);

  const claims = mergeClaims(activeClaims, sourceRunClaims, maxClaims);
  const activeClaimIds = new Set(claims.map((claim) => claim.id));
  const edges = (await getEdgesForAccount(db, options.accountId, maxEdges))
    .filter((edge) =>
      activeClaimIds.has(edge.sourceClaimId) &&
      activeClaimIds.has(edge.targetClaimId)
    );

  const candidates = buildPathCandidates(claims, edges, maxHops)
    .slice(0, maxPaths);
  const now = new Date().toISOString();

  await deletePathsForAccount(db, options.accountId);
  for (const candidate of candidates) {
    await insertPath(db, {
      id: generateId(),
      accountId: options.accountId,
      startClaimId: candidate.startClaimId,
      endClaimId: candidate.endClaimId,
      hopCount: candidate.pathRelations.length,
      pathClaims: candidate.pathClaims,
      pathRelations: candidate.pathRelations,
      pathSummary: candidate.pathRelations.join(" -> "),
      minConfidence: candidate.minConfidence,
      createdAt: now,
    });
  }

  return {
    claimCount: claims.length,
    edgeCount: edges.length,
    sourceRunClaimCount: sourceRunClaims.length,
    insertedPathCount: candidates.length,
  };
}

function mergeClaims(
  primary: Claim[],
  required: Claim[],
  maxClaims: number,
): Claim[] {
  const byId = new Map<string, Claim>();
  for (const claim of primary) byId.set(claim.id, claim);
  for (const claim of required) byId.set(claim.id, claim);

  const requiredIds = new Set(required.map((claim) => claim.id));
  const sorted = [...byId.values()].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const prioritized = sorted.filter((claim) => requiredIds.has(claim.id));
  const backfill = sorted.filter((claim) => !requiredIds.has(claim.id));

  return [...prioritized, ...backfill].slice(0, maxClaims).sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

export function buildPathCandidates(
  claims: Claim[],
  edges: ClaimEdge[],
  maxHops: number = MAX_PATH_HOPS,
): PathCandidate[] {
  if (claims.length === 0 || edges.length === 0 || maxHops < 1) return [];

  const claimsById = new Map(claims.map((claim) => [claim.id, claim]));
  const outgoing = new Map<string, ClaimEdge[]>();
  for (const edge of edges) {
    const sourceEdges = outgoing.get(edge.sourceClaimId) ?? [];
    sourceEdges.push(edge);
    outgoing.set(edge.sourceClaimId, sourceEdges);
  }
  for (const sourceEdges of outgoing.values()) {
    sourceEdges.sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      return a.targetClaimId.localeCompare(b.targetClaimId);
    });
  }

  const candidates = new Map<string, PathCandidate>();
  const startClaims = [...claims].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.id.localeCompare(b.id);
  });

  for (const start of startClaims) {
    visitPath(
      start.id,
      start.id,
      [start.id],
      [],
      start.confidence,
      new Set([start.id]),
      claimsById,
      outgoing,
      maxHops,
      candidates,
    );
  }

  return [...candidates.values()].sort((a, b) => {
    if (b.minConfidence !== a.minConfidence) {
      return b.minConfidence - a.minConfidence;
    }
    if (a.pathRelations.length !== b.pathRelations.length) {
      return a.pathRelations.length - b.pathRelations.length;
    }
    return a.pathClaims.join("\0").localeCompare(b.pathClaims.join("\0"));
  });
}

function visitPath(
  startClaimId: string,
  currentClaimId: string,
  pathClaims: string[],
  pathRelations: string[],
  minConfidence: number,
  visited: Set<string>,
  claimsById: Map<string, Claim>,
  outgoing: Map<string, ClaimEdge[]>,
  maxHops: number,
  candidates: Map<string, PathCandidate>,
): void {
  if (pathRelations.length >= maxHops) return;

  for (const edge of outgoing.get(currentClaimId) ?? []) {
    if (visited.has(edge.targetClaimId)) continue;
    const targetClaim = claimsById.get(edge.targetClaimId);
    if (!targetClaim) continue;

    const nextPathClaims = [...pathClaims, edge.targetClaimId];
    const nextPathRelations = [...pathRelations, edge.relation];
    const nextMinConfidence = Math.min(
      minConfidence,
      targetClaim.confidence,
    );
    const key = `${startClaimId}:${edge.targetClaimId}:${
      nextPathClaims.join(">")
    }:${nextPathRelations.join(">")}`;

    candidates.set(key, {
      startClaimId,
      endClaimId: edge.targetClaimId,
      pathClaims: nextPathClaims,
      pathRelations: nextPathRelations,
      minConfidence: nextMinConfidence,
    });

    const nextVisited = new Set(visited);
    nextVisited.add(edge.targetClaimId);
    visitPath(
      startClaimId,
      edge.targetClaimId,
      nextPathClaims,
      nextPathRelations,
      nextMinConfidence,
      nextVisited,
      claimsById,
      outgoing,
      maxHops,
      candidates,
    );
  }
}

export type { PathCandidate };
