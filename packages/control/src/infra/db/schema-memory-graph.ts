import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

// Memory Activation Graph schema. The runtime accesses these tables via
// raw SQL in `application/services/memory-graph/claim-store.ts` (which uses
// `db.prepare(...).bind(...)` rather than the drizzle query builder), so the
// drizzle declarations here exist primarily to keep `drizzle-kit` from
// emitting spurious migrations and to give callers a typed handle if they
// want to switch to the query builder later. The canonical schema is
// `apps/control/db/migrations/0006_memory_activation_graph.sql`.

// Subject-predicate-object claims with confidence + lifecycle.
export const memoryClaims = sqliteTable("memory_claims", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  claimType: text("claim_type").notNull().default("fact"),
  subject: text("subject").notNull(),
  predicate: text("predicate").notNull(),
  object: text("object").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  status: text("status").notNull().default("active"),
  supersededBy: text("superseded_by"),
  sourceRunId: text("source_run_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => ({
  idxAccount: index("idx_memory_claims_account").on(table.accountId),
  idxAccountSubject: index("idx_memory_claims_account_subject").on(
    table.accountId,
    table.subject,
  ),
  idxAccountStatus: index("idx_memory_claims_account_status").on(
    table.accountId,
    table.status,
  ),
}));

// Supporting / contradicting evidence pinned to claims.
export const memoryEvidence = sqliteTable("memory_evidence", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  claimId: text("claim_id").notNull(),
  kind: text("kind").notNull().default("supports"),
  sourceType: text("source_type").notNull(),
  sourceRef: text("source_ref"),
  content: text("content").notNull(),
  trust: real("trust").notNull().default(0.7),
  taint: text("taint"),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  idxClaim: index("idx_memory_evidence_claim").on(table.claimId),
  idxAccount: index("idx_memory_evidence_account").on(table.accountId),
  idxSource: index("idx_memory_evidence_source").on(
    table.sourceType,
    table.sourceRef,
  ),
}));

// Directed claim → claim edges expressing relationships.
export const memoryClaimEdges = sqliteTable("memory_claim_edges", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  sourceClaimId: text("source_claim_id").notNull(),
  targetClaimId: text("target_claim_id").notNull(),
  relation: text("relation").notNull(),
  weight: real("weight").notNull().default(1.0),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  idxSource: index("idx_memory_claim_edges_source").on(table.sourceClaimId),
  idxTarget: index("idx_memory_claim_edges_target").on(table.targetClaimId),
  idxAccount: index("idx_memory_claim_edges_account").on(table.accountId),
}));

// Pre-materialized multi-hop paths between claims used for fast activation.
// Currently only written/read via raw SQL helpers in claim-store.ts; see
// also runtime/indexer/handlers.ts handleMemoryBuildPaths (stub).
export const memoryPaths = sqliteTable("memory_paths", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  startClaimId: text("start_claim_id").notNull(),
  endClaimId: text("end_claim_id").notNull(),
  hopCount: integer("hop_count").notNull(),
  pathClaims: text("path_claims").notNull(),
  pathRelations: text("path_relations").notNull(),
  pathSummary: text("path_summary"),
  minConfidence: real("min_confidence").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => ({
  idxAccount: index("idx_memory_paths_account").on(table.accountId),
  idxAccountStart: index("idx_memory_paths_account_start").on(
    table.accountId,
    table.startClaimId,
  ),
  idxAccountEnd: index("idx_memory_paths_account_end").on(
    table.accountId,
    table.endClaimId,
  ),
}));
