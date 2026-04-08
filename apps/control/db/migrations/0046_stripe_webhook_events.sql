-- Stripe webhook event idempotency dedup table.
--
-- Stripe retries failed deliveries for up to 3 days and may replay events.
-- Without dedup, retried `checkout.session.completed` events for a Pro top-up
-- would call addCredits() multiple times, double-crediting the user.

CREATE TABLE stripe_webhook_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT
);

CREATE INDEX idx_stripe_webhook_events_type ON stripe_webhook_events (type);
CREATE INDEX idx_stripe_webhook_events_received_at ON stripe_webhook_events (received_at);
