ALTER TABLE run_events ADD COLUMN event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_run_events_event_key
  ON run_events(event_key);
