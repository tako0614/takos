-- Phase 1: Run Lease (CAS) - prevents double execution of runs
ALTER TABLE runs ADD COLUMN lease_version INTEGER NOT NULL DEFAULT 0;

-- Phase 2: Tool Operations - idempotent tool execution tracking
CREATE TABLE tool_operations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result_output TEXT,
  result_error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX idx_tool_operations_key ON tool_operations(run_id, operation_key);
CREATE INDEX idx_tool_operations_run_id ON tool_operations(run_id);
