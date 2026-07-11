-- takos-migration-safety: expand
-- takos-migration-approval: Adds nullable lease-fenced agent engine checkpoint fields; large payloads are stored in TAKOS_OFFLOAD and only a bounded R2 reference is kept in D1.
-- takos-migration-rollback: Roll the agent wrapper and Worker checkpoint RPCs back first, then leave these nullable columns in place; older code ignores them safely.

-- Persist one lease-fenced takos-agent-engine checkpoint per Run so a fresh
-- executor can resume an idempotent node after container loss. The terminal
-- complete-run transaction clears both fields.
ALTER TABLE runs ADD COLUMN engine_checkpoint TEXT;
ALTER TABLE runs ADD COLUMN engine_checkpoint_updated_at TEXT;
