-- takos-migration-safety: backfill
-- takos-migration-approval: Adds a DB-owned per-thread sequence allocator and records each terminal transcript reservation on its Run so concurrent replicas cannot interleave messages inside an assistant/tool transcript.
-- takos-migration-rollback: Roll application code back first. Keep both nullable/additive columns; old readers ignore them and retaining counters avoids reusing an already reserved sequence.

ALTER TABLE threads
  ADD COLUMN next_message_sequence INTEGER NOT NULL DEFAULT 0;

UPDATE threads
SET next_message_sequence = COALESCE(
  (
    SELECT MAX(messages.sequence) + 1
    FROM messages
    WHERE messages.thread_id = threads.id
  ),
  0
);

ALTER TABLE runs
  ADD COLUMN transcript_sequence_start INTEGER;
