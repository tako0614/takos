-- ActivityPub delivery retry queue
--
-- Persists outbound deliveries so failed POSTs can be retried with backoff.
-- Round 11 (ActivityPub delivery findings) — prior to this, deliverToFollowers
-- used one-shot Promise.allSettled and dropped failed inboxes on the floor.
--
-- Lifecycle:
--   pending   -> picked up by tickDeliveryQueue, POSTed with HTTP Signatures
--   delivered -> 2xx response from inbox
--   failed    -> dead-letter after backoff ladder exhausted (attempts >= 7)

CREATE TABLE ap_delivery_queue (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  inbox_url TEXT NOT NULL,
  payload TEXT NOT NULL,
  signing_key_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_ap_delivery_queue_status_next
  ON ap_delivery_queue (status, next_attempt_at);

CREATE INDEX idx_ap_delivery_queue_activity_id
  ON ap_delivery_queue (activity_id);
