import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
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

// The claim `id` is caller-supplied (it arrives in the control-RPC body from the
// untrusted execution container). `account_id` is forced to the token-bound run's
// tenant upstream, so the conflict-update is scoped to `account_id = excluded.account_id`:
// a guessed/forged id that belongs to a DIFFERENT tenant's claim hits the conflict
// but the WHERE fails, so the foreign row is left untouched instead of being
// overwritten (and re-homed) into the attacker's tenant. Same-tenant re-finalize of
// the same id still updates; a brand-new id still inserts.
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
     updated_at = excluded.updated_at
   WHERE memory_claims.account_id = excluded.account_id`;

export async function insertClaim(
  db: SqlDatabaseBinding,
  claim: ClaimInsert,
): Promise<void> {
  await db.prepare(INSERT_CLAIM_SQL).bind(
    ...claimBindParams(claim, new Date().toISOString()),
  ).run();
}

export async function upsertClaim(
  db: SqlDatabaseBinding,
  claim: ClaimInsert,
): Promise<void> {
  await db.prepare(UPSERT_CLAIM_SQL).bind(
    ...claimBindParams(claim, new Date().toISOString()),
  ).run();
}

export async function getActiveClaims(
  db: SqlDatabaseBinding,
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

export async function getActiveClaimsByRun(
  db: SqlDatabaseBinding,
  accountId: string,
  sourceRunId: string,
  limit: number = 50,
): Promise<Claim[]> {
  const result = await db.prepare(
    `SELECT id, account_id, claim_type, subject, predicate, object, confidence, status, superseded_by, source_run_id, created_at, updated_at
     FROM memory_claims
     WHERE account_id = ? AND status = 'active' AND source_run_id = ?
     ORDER BY confidence DESC, updated_at DESC
     LIMIT ?`,
  ).bind(accountId, sourceRunId, limit).all();

  return (result.results ?? []).map(rowToClaim);
}

/**
 * Escapes `%` and `_` (SQL LIKE wildcards) and the escape character `\` itself
 * so user-provided text can be safely wrapped in `%...%` for a substring match
 * without leaking pattern semantics to the caller.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export async function searchClaims(
  db: SqlDatabaseBinding,
  accountId: string,
  query: string,
  limit: number = 10,
): Promise<Claim[]> {
  const pattern = `%${escapeLikePattern(query)}%`;
  const result = await db.prepare(
    `SELECT id, account_id, claim_type, subject, predicate, object, confidence, status, superseded_by, source_run_id, created_at, updated_at
     FROM memory_claims
     WHERE account_id = ? AND status = 'active'
       AND (subject LIKE ? ESCAPE '\\' OR predicate LIKE ? ESCAPE '\\' OR object LIKE ? ESCAPE '\\')
     ORDER BY confidence DESC
     LIMIT ?`,
  ).bind(accountId, pattern, pattern, pattern, limit).all();

  return (result.results ?? []).map(rowToClaim);
}

/**
 * Updates a claim's status. The caller MUST pass `accountId` so that the
 * UPDATE is scoped to the owning tenant; without that predicate, a caller
 * holding a foreign `claimId` could mutate another tenant's claim.
 */
export async function updateClaimStatus(
  db: SqlDatabaseBinding,
  accountId: string,
  claimId: string,
  status: ClaimStatus,
  supersededBy?: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE memory_claims SET status = ?, superseded_by = ?, updated_at = ? WHERE id = ? AND account_id = ?`,
  ).bind(status, supersededBy ?? null, now, claimId, accountId).run();
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
  db: SqlDatabaseBinding,
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

/**
 * Returns evidence for a claim, scoped to the owning tenant. The JOIN against
 * memory_claims + the account_id predicate ensures a caller cannot read
 * evidence by guessing a claimId that belongs to another tenant.
 */
export async function getEvidenceForClaim(
  db: SqlDatabaseBinding,
  accountId: string,
  claimId: string,
  limit: number = 20,
): Promise<Evidence[]> {
  const result = await db.prepare(
    `SELECT e.id, e.account_id, e.claim_id, e.kind, e.source_type, e.source_ref, e.content, e.trust, e.taint, e.created_at
     FROM memory_evidence AS e
     INNER JOIN memory_claims AS c
       ON c.id = e.claim_id AND c.account_id = e.account_id
     WHERE e.claim_id = ? AND e.account_id = ?
     ORDER BY e.trust DESC, e.created_at DESC
     LIMIT ?`,
  ).bind(claimId, accountId, limit).all();

  return (result.results ?? []).map(rowToEvidence);
}

/**
 * Counts evidence rows per claim, scoped to the owning tenant. The
 * `account_id` predicate matches every other read in this file and enforces
 * tenant isolation defensively: counts never include evidence attributed to
 * another account even if a caller passes a claimId from another tenant.
 */
export async function countEvidenceForClaims(
  db: SqlDatabaseBinding,
  accountId: string,
  claimIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (claimIds.length === 0) return counts;

  for (let i = 0; i < claimIds.length; i += 20) {
    const batch = claimIds.slice(i, i + 20);
    const placeholders = batch.map(() => "?").join(",");
    const result = await db.prepare(
      `SELECT claim_id, COUNT(*) as cnt FROM memory_evidence WHERE account_id = ? AND claim_id IN (${placeholders}) GROUP BY claim_id`,
    ).bind(accountId, ...batch).all();

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
  db: SqlDatabaseBinding,
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

/**
 * Returns outgoing edges from `claimId`, scoped to the owning tenant. The
 * JOIN against memory_claims + account_id predicate prevents cross-tenant
 * graph traversal.
 */
export async function getEdgesFrom(
  db: SqlDatabaseBinding,
  accountId: string,
  claimId: string,
): Promise<ClaimEdge[]> {
  const result = await db.prepare(
    `SELECT e.id, e.account_id, e.source_claim_id, e.target_claim_id, e.relation, e.weight, e.created_at
     FROM memory_claim_edges AS e
     INNER JOIN memory_claims AS c
       ON c.id = e.source_claim_id AND c.account_id = e.account_id
     WHERE e.source_claim_id = ? AND e.account_id = ?`,
  ).bind(claimId, accountId).all();

  return (result.results ?? []).map(rowToEdge);
}

/**
 * Returns incoming edges to `claimId`, scoped to the owning tenant. The JOIN
 * against memory_claims + account_id predicate prevents cross-tenant graph
 * traversal.
 */
export async function getEdgesTo(
  db: SqlDatabaseBinding,
  accountId: string,
  claimId: string,
): Promise<ClaimEdge[]> {
  const result = await db.prepare(
    `SELECT e.id, e.account_id, e.source_claim_id, e.target_claim_id, e.relation, e.weight, e.created_at
     FROM memory_claim_edges AS e
     INNER JOIN memory_claims AS c
       ON c.id = e.target_claim_id AND c.account_id = e.account_id
     WHERE e.target_claim_id = ? AND e.account_id = ?`,
  ).bind(claimId, accountId).all();

  return (result.results ?? []).map(rowToEdge);
}

export async function getEdgesForAccount(
  db: SqlDatabaseBinding,
  accountId: string,
  limit: number = 1000,
): Promise<ClaimEdge[]> {
  const result = await db.prepare(
    `SELECT id, account_id, source_claim_id, target_claim_id, relation, weight, created_at
     FROM memory_claim_edges
     WHERE account_id = ?
     ORDER BY weight DESC, created_at DESC
     LIMIT ?`,
  ).bind(accountId, limit).all();

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
  db: SqlDatabaseBinding,
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
  db: SqlDatabaseBinding,
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
  db: SqlDatabaseBinding,
  accountId: string,
): Promise<void> {
  await db.prepare(
    `DELETE FROM memory_paths WHERE account_id = ?`,
  ).bind(accountId).run();
}

export async function countPathsForAccount(
  db: SqlDatabaseBinding,
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
