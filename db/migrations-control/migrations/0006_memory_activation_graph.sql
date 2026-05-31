-- Memory Activation Graph: claim + evidence model with path indexing
-- Phase 1: core tables for structured memory with trust/taint

-- Claims: subject-predicate-object triples with confidence and lifecycle
CREATE TABLE memory_claims (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  claim_type TEXT NOT NULL DEFAULT 'fact',
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active',
  superseded_by TEXT,
  source_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_memory_claims_account ON memory_claims(account_id);
CREATE INDEX idx_memory_claims_account_subject ON memory_claims(account_id, subject);
CREATE INDEX idx_memory_claims_account_status ON memory_claims(account_id, status);

-- Evidence: supporting/contradicting references for claims
CREATE TABLE memory_evidence (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'supports',
  source_type TEXT NOT NULL,
  source_ref TEXT,
  content TEXT NOT NULL,
  trust REAL NOT NULL DEFAULT 0.7,
  taint TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_memory_evidence_claim ON memory_evidence(claim_id);
CREATE INDEX idx_memory_evidence_account ON memory_evidence(account_id);
CREATE INDEX idx_memory_evidence_source ON memory_evidence(source_type, source_ref);

-- Claim edges: relationships between claims
CREATE TABLE memory_claim_edges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  source_claim_id TEXT NOT NULL,
  target_claim_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1.0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_memory_claim_edges_source ON memory_claim_edges(source_claim_id);
CREATE INDEX idx_memory_claim_edges_target ON memory_claim_edges(target_claim_id);
CREATE INDEX idx_memory_claim_edges_account ON memory_claim_edges(account_id);

-- Paths: pre-materialized multi-hop paths between claims
CREATE TABLE memory_paths (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  start_claim_id TEXT NOT NULL,
  end_claim_id TEXT NOT NULL,
  hop_count INTEGER NOT NULL,
  path_claims TEXT NOT NULL,
  path_relations TEXT NOT NULL,
  path_summary TEXT,
  min_confidence REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_memory_paths_account ON memory_paths(account_id);
CREATE INDEX idx_memory_paths_account_start ON memory_paths(account_id, start_claim_id);
CREATE INDEX idx_memory_paths_account_end ON memory_paths(account_id, end_claim_id);
