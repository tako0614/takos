import type { D1Database } from "../../../shared/types/bindings.ts";
import type {
  Claim,
  ClaimEdge,
  ClaimEdgeInsert,
  ClaimInsert,
  ClaimPath,
  ClaimStatus,
  Evidence,
  EvidenceInsert,
} from "./graph-models.ts";

function claimBindParams(claim: ClaimInsert, now: string) {
  return [
    claim.id,
    claim.accountId,
    claim.claimType,
    claim.subject,
    claim.predicate,
    claim.object,
    claim.confidence ?? 0.5,
    claim.status ?? "active",
    claim.supersededBy ?? null,
    claim.sourceRunId ?? null,
    now,
    now,
  ] as const;
}

const INSERT_CLAIM_SQL =
  `INSERT INTO memory_claims (id, account_id, claim_type, subject, predicate, object, confidence, status, superseded_by, source_run_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_CLAIM_SQL = `${INSERT_CLAIM_SQL}
   ON CONFLICT(id) DO UPDATE SET
     claim_type = excluded.claim_type,
     subject = excluded.subject,
     predicate = excluded.predicate,
     object = excluded.object,
     confidence = excluded.confidence,
     status = excluded.status,
     superseded_by = excluded.superseded_by,
     source_run_id = excluded.source_run_id,
     updated_at = excluded.updated_at`;

export async function insertClaim(
  db: D1Database,
  claim: ClaimInsert,
): Promise<void> {
  await db.prepare(INSERT_CLAIM_SQL).bind(
    ...claimBindParams(claim, new Date().toISOString()),
  ).run();
}

export async function upsertClaim(
  db: D1Database,
  claim: ClaimInsert,
): Promise<void> {
  await db.prepare(UPSERT_CLAIM_SQL).bind(
    ...claimBindParams(claim, new Date().toISOString()),
  ).run();
}

export async function getActiveClaims(
  db: D1Database,
  accountId: string,
  limit: number = 50,
): Promise<Claim[]> {
  const result = await db.prepare(
    `SELECT id, account_id, claim_type, subject, predicate, object, confidence, status, superseded_by, source_run_id, created_at, updated_at
     FROM memory_claims
     WHERE account_id = ? AND status = 'active'
     ORDER BY confidence DESC, updated_at DESC
     LIMIT ?`,
  ).bind(accountId, limit).all();

  return (result.results ?? []).map(rowToClaim);
}

export async function searchClaims(
  db: D1Database,
  accountId: string,
  query: string,
  limit: number = 10,
): Promise<Claim[]> {
  const pattern = `%${query}%`;
  const result = await db.prepare(
    `SELECT id, account_id, claim_type, subject, predicate, object, confidence, status, superseded_by, source_run_id, created_at, updated_at
     FROM memory_claims
     WHERE account_id = ? AND status = 'active'
       AND (subject LIKE ? OR predicate LIKE ? OR object LIKE ?)
     ORDER BY confidence DESC
     LIMIT ?`,
  ).bind(accountId, pattern, pattern, pattern, limit).all();

  return (result.results ?? []).map(rowToClaim);
}

export async function updateClaimStatus(
  db: D1Database,
  claimId: string,
  status: ClaimStatus,
  supersededBy?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE memory_claims SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ?`,
  ).bind(status, supersededBy ?? null, now, claimId).run();
}

function rowToClaim(row: Record<string, unknown>): Claim {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    claimType: row.claim_type as Claim["claimType"],
    subject: row.subject as string,
    predicate: row.predicate as string,
    object: row.object as string,
    confidence: row.confidence as number,
    status: row.status as Claim["status"],
    supersededBy: (row.superseded_by as string) || null,
    sourceRunId: (row.source_run_id as string) || null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function insertEvidence(
  db: D1Database,
  evidence: EvidenceInsert,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO memory_evidence (id, account_id, claim_id, kind, source_type, source_ref, content, trust, taint, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    evidence.id,
    evidence.accountId,
    evidence.claimId,
    evidence.kind,
    evidence.sourceType,
    evidence.sourceRef ?? null,
    evidence.content.slice(0, 2048),
    evidence.trust ?? 0.7,
    evidence.taint ?? null,
    now,
  ).run();
}

export async function getEvidenceForClaim(
  db: D1Database,
  claimId: string,
  limit: number = 20,
): Promise<Evidence[]> {
  const result = await db.prepare(
    `SELECT id, account_id, claim_id, kind, source_type, source_ref, content, trust, taint, created_at
     FROM memory_evidence
     WHERE claim_id = ?
     ORDER BY trust DESC, created_at DESC
     LIMIT ?`,
  ).bind(claimId, limit).all();

  return (result.results ?? []).map(rowToEvidence);
}

export async function countEvidenceForClaims(
  db: D1Database,
  claimIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (claimIds.length === 0) return counts;

  for (let i = 0; i < claimIds.length; i += 20) {
    const batch = claimIds.slice(i, i + 20);
    const placeholders = batch.map(() => "?").join(",");
    const result = await db.prepare(
      `SELECT claim_id, COUNT(*) as cnt FROM memory_evidence WHERE claim_id IN (${placeholders}) GROUP BY claim_id`,
    ).bind(...batch).all();

    for (const row of result.results ?? []) {
      counts.set(row.claim_id as string, row.cnt as number);
    }
  }

  return counts;
}

function rowToEvidence(row: Record<string, unknown>): Evidence {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    claimId: row.claim_id as string,
    kind: row.kind as Evidence["kind"],
    sourceType: row.source_type as Evidence["sourceType"],
    sourceRef: (row.source_ref as string) || null,
    content: row.content as string,
    trust: row.trust as number,
    taint: (row.taint as string) || null,
    createdAt: row.created_at as string,
  };
}

export async function insertEdge(
  db: D1Database,
  edge: ClaimEdgeInsert,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO memory_claim_edges (id, account_id, source_claim_id, target_claim_id, relation, weight, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    edge.id,
    edge.accountId,
    edge.sourceClaimId,
    edge.targetClaimId,
    edge.relation,
    edge.weight ?? 1.0,
    now,
  ).run();
}

export async function getEdgesFrom(
  db: D1Database,
  claimId: string,
): Promise<ClaimEdge[]> {
  const result = await db.prepare(
    `SELECT id, account_id, source_claim_id, target_claim_id, relation, weight, created_at
     FROM memory_claim_edges
     WHERE source_claim_id = ?`,
  ).bind(claimId).all();

  return (result.results ?? []).map(rowToEdge);
}

export async function getEdgesTo(
  db: D1Database,
  claimId: string,
): Promise<ClaimEdge[]> {
  const result = await db.prepare(
    `SELECT id, account_id, source_claim_id, target_claim_id, relation, weight, created_at
     FROM memory_claim_edges
     WHERE target_claim_id = ?`,
  ).bind(claimId).all();

  return (result.results ?? []).map(rowToEdge);
}

function rowToEdge(row: Record<string, unknown>): ClaimEdge {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    sourceClaimId: row.source_claim_id as string,
    targetClaimId: row.target_claim_id as string,
    relation: row.relation as ClaimEdge["relation"],
    weight: row.weight as number,
    createdAt: row.created_at as string,
  };
}

export async function insertPath(
  db: D1Database,
  path: ClaimPath,
): Promise<void> {
  await db.prepare(
    `INSERT INTO memory_paths (id, account_id, start_claim_id, end_claim_id, hop_count, path_claims, path_relations, path_summary, min_confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    path.id,
    path.accountId,
    path.startClaimId,
    path.endClaimId,
    path.hopCount,
    JSON.stringify(path.pathClaims),
    JSON.stringify(path.pathRelations),
    path.pathSummary,
    path.minConfidence,
    path.createdAt,
  ).run();
}

export async function getPathsForClaim(
  db: D1Database,
  accountId: string,
  claimId: string,
  limit: number = 10,
): Promise<ClaimPath[]> {
  const result = await db.prepare(
    `SELECT id, account_id, start_claim_id, end_claim_id, hop_count, path_claims, path_relations, path_summary, min_confidence, created_at
     FROM memory_paths
     WHERE account_id = ? AND (start_claim_id = ? OR end_claim_id = ?)
     ORDER BY min_confidence DESC
     LIMIT ?`,
  ).bind(accountId, claimId, claimId, limit).all();

  return (result.results ?? []).map(rowToPath);
}

export async function deletePathsForAccount(
  db: D1Database,
  accountId: string,
): Promise<void> {
  await db.prepare(
    `DELETE FROM memory_paths WHERE account_id = ?`,
  ).bind(accountId).run();
}

export async function countPathsForAccount(
  db: D1Database,
  accountId: string,
): Promise<number> {
  const result = await db.prepare(
    `SELECT COUNT(*) as cnt FROM memory_paths WHERE account_id = ?`,
  ).bind(accountId).first();
  return (result?.cnt as number) ?? 0;
}

function rowToPath(row: Record<string, unknown>): ClaimPath {
  return {
    id: row.id as string,
    accountId: row.account_id as string,
    startClaimId: row.start_claim_id as string,
    endClaimId: row.end_claim_id as string,
    hopCount: row.hop_count as number,
    pathClaims: (() => {
      try {
        return JSON.parse(row.path_claims as string);
      } catch {
        return [];
      }
    })(),
    pathRelations: (() => {
      try {
        return JSON.parse(row.path_relations as string);
      } catch {
        return [];
      }
    })(),
    pathSummary: (row.path_summary as string) || null,
    minConfidence: row.min_confidence as number,
    createdAt: row.created_at as string,
  };
}
