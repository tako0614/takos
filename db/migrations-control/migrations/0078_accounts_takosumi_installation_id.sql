-- Takosumi Installation ID for Space-Installation binding (Phase 4 Step B).
-- takos-migration-safety: expand
ALTER TABLE accounts ADD COLUMN takosumi_installation_id TEXT;
