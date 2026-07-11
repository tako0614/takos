-- takos-migration-safety: expand
-- takos-migration-approval: Adds a nullable completion identity used to atomically fence terminal run transcript and event inserts.
-- takos-migration-rollback: Roll application code back while retaining the nullable column and index; older Takos versions ignore both and Takos app migrations are forward-only.

-- Atomic agent finalization marker. Transcript/event inserts select through
-- this key after the lease-fenced runs CAS, so a losing cancel/completion race
-- cannot persist orphan messages or a terminal event.
ALTER TABLE runs ADD COLUMN completion_key TEXT;

CREATE INDEX IF NOT EXISTS idx_runs_completion_key
  ON runs(completion_key);
