ALTER TABLE runs ADD COLUMN child_thread_id TEXT;
ALTER TABLE runs ADD COLUMN root_thread_id TEXT;
ALTER TABLE runs ADD COLUMN root_run_id TEXT;

UPDATE runs
SET root_thread_id = thread_id
WHERE root_thread_id IS NULL;

WITH RECURSIVE run_roots(id, root_run_id) AS (
  SELECT id, id
  FROM runs
  WHERE parent_run_id IS NULL

  UNION ALL

  SELECT child.id, run_roots.root_run_id
  FROM runs AS child
  JOIN run_roots ON child.parent_run_id = run_roots.id
)
UPDATE runs
SET root_run_id = (
  SELECT run_roots.root_run_id
  FROM run_roots
  WHERE run_roots.id = runs.id
)
WHERE root_run_id IS NULL;

UPDATE runs
SET root_run_id = id
WHERE root_run_id IS NULL;

CREATE INDEX idx_runs_child_thread_id ON runs(child_thread_id);
CREATE INDEX idx_runs_root_thread_id ON runs(root_thread_id);
CREATE INDEX idx_runs_root_run_id ON runs(root_run_id);
