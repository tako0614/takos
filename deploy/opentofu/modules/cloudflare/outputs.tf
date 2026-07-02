# Output surface: non-secret resource IDs/names that the Worker artifact
# upload and Takosumi Run/StateVersion/Output ledger consume as the binding map.

# Cloudflare account id — echoed from the input so the follow-up artifact
# materialization can read CF_ACCOUNT_ID from the same Output value. Not a
# managed resource; this is the account the durable resources were created in.
output "account_id" {
  description = "Cloudflare account ID the resources were provisioned in (for the CF_ACCOUNT_ID worker var)."
  value       = var.account_id
}

output "worker_name" {
  description = "Worker script name rendered into wrangler.toml for the artifact upload."
  value       = local.worker_name
}

output "launch_url" {
  description = "Public workers.dev URL when a workers_subdomain input is supplied."
  value       = var.workers_subdomain != null && trimspace(var.workers_subdomain) != "" ? "https://${local.worker_name}.${var.workers_subdomain}.workers.dev" : null
}

# Product control-plane D1 — binding DB.
output "d1_database_id" {
  description = "D1 database ID for the DB binding."
  value       = cloudflare_d1_database.this["db"].id
}

output "d1_database_name" {
  description = "D1 database name for the DB binding."
  value       = cloudflare_d1_database.this["db"].name
}

# All D1 database IDs keyed by logical binding (db).
output "d1_database_ids" {
  description = "D1 database IDs keyed by logical binding (db)."
  value       = { for k, v in cloudflare_d1_database.this : k => v.id }
}

output "kv_namespace_ids" {
  description = "KV namespace IDs keyed by logical binding (hostname_routing, rollout_health)."
  value       = { for k, v in cloudflare_workers_kv_namespace.this : k => v.id }
}

output "r2_bucket_names" {
  description = "R2 bucket names keyed by logical binding."
  value       = { for k, v in cloudflare_r2_bucket.this : k => v.name }
}

output "queue_names" {
  description = "Queue names keyed by logical binding (incl. *_dlq)."
  value       = { for k, v in cloudflare_queue.this : k => v.queue_name }
}

output "vectorize_index_name" {
  description = "Expected Vectorize index name for the VECTORIZE binding (created out-of-band; not provider-managed)."
  value       = local.vectorize.index_name
}

output "vectorize_index_dimensions" {
  description = "Vector dimensions expected by the VECTORIZE binding."
  value       = local.vectorize.dimensions
}

output "vectorize_index_metric" {
  description = "Vector distance metric expected by the VECTORIZE binding."
  value       = local.vectorize.metric
}
