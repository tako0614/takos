-- Seed canonical billing plans, quotas, and rates

INSERT INTO "billing_plans" ("id", "name", "display_name", "description", "is_default", "created_at", "updated_at")
VALUES
  ('plan_free', 'free', 'Free', 'Default free plan', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_plus', 'plus', 'Plus', 'Plus plan', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('plan_payg', 'payg', 'Pay As You Go', 'Pay-as-you-go plan', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT("id") DO UPDATE SET
  "name" = excluded."name",
  "display_name" = excluded."display_name",
  "description" = excluded."description",
  "is_default" = excluded."is_default",
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "billing_plan_quotas" ("plan_id", "quota_key", "limit_value")
VALUES
  ('plan_free', 'llm_tokens_input', 20000),
  ('plan_free', 'llm_tokens_output', 10000),
  ('plan_free', 'embedding_count', 200),
  ('plan_free', 'vector_search_count', 100),
  ('plan_free', 'exec_seconds', 600),
  ('plan_free', 'web_search_count', 20),
  ('plan_free', 'r2_storage_gb_month', 1),
  ('plan_free', 'wfp_requests', 100),
  ('plan_free', 'queue_messages', 100),
  ('plan_plus', 'llm_tokens_input', 250000),
  ('plan_plus', 'llm_tokens_output', 125000),
  ('plan_plus', 'embedding_count', 2500),
  ('plan_plus', 'vector_search_count', 1250),
  ('plan_plus', 'exec_seconds', 1800),
  ('plan_plus', 'web_search_count', 400),
  ('plan_plus', 'r2_storage_gb_month', 5),
  ('plan_plus', 'wfp_requests', 1000),
  ('plan_plus', 'queue_messages', 1000),
  ('plan_payg', 'llm_tokens_input', -1),
  ('plan_payg', 'llm_tokens_output', -1),
  ('plan_payg', 'embedding_count', -1),
  ('plan_payg', 'vector_search_count', -1),
  ('plan_payg', 'exec_seconds', -1),
  ('plan_payg', 'web_search_count', -1),
  ('plan_payg', 'r2_storage_gb_month', -1),
  ('plan_payg', 'wfp_requests', -1),
  ('plan_payg', 'queue_messages', -1)
ON CONFLICT("plan_id", "quota_key") DO UPDATE SET
  "limit_value" = excluded."limit_value";

INSERT INTO "billing_plan_rates" ("plan_id", "meter_type", "rate_cents")
VALUES
  ('plan_payg', 'llm_tokens_input', 3),
  ('plan_payg', 'llm_tokens_output', 15),
  ('plan_payg', 'embedding_count', 1),
  ('plan_payg', 'vector_search_count', 2),
  ('plan_payg', 'exec_seconds', 5),
  ('plan_payg', 'web_search_count', 5),
  ('plan_payg', 'r2_storage_gb_month', 2300),
  ('plan_payg', 'wfp_requests', 1),
  ('plan_payg', 'queue_messages', 1)
ON CONFLICT("plan_id", "meter_type") DO UPDATE SET
  "rate_cents" = excluded."rate_cents";
