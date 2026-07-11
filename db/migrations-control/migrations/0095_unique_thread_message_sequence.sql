-- takos-migration-safety: backfill
-- takos-migration-approval: Deterministically repairs legacy ordering before enforcing the provider-transcript invariant; application writers already retry sequence conflicts.
-- takos-migration-rollback: Roll application code back while retaining the repaired sequences and unique index; legacy readers are compatible and writers already handle conflicts. If index creation fails, stop writes, rerun the duplicate audit/repair, and apply this forward migration again.

-- Message order is part of the provider transcript contract. Repair any
-- historical duplicate/gapped sequence values deterministically, then make
-- concurrent writers retry instead of silently committing an ambiguous order.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY thread_id
      ORDER BY sequence ASC, created_at ASC, id ASC
    ) - 1 AS repaired_sequence
  FROM messages
)
UPDATE messages
SET sequence = (
  SELECT ranked.repaired_sequence
  FROM ranked
  WHERE ranked.id = messages.id
);

DROP INDEX IF EXISTS idx_messages_thread_sequence;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_thread_sequence
  ON messages(thread_id, sequence);
