# DeploymentOutput surface: non-secret resource IDs/names that the Worker
# artifact (uploaded by the follow-up `wrangler deploy`) and Takosumi's
# Deployment record consume as the binding map.

# Product control-plane D1 — binding DB.
output "d1_database_id" {
  description = "D1 database ID for the DB binding."
  value       = cloudflare_d1_database.this["db"].id
}

output "d1_database_name" {
  description = "D1 database name for the DB binding."
  value       = cloudflare_d1_database.this["db"].name
}

# Account-plane D1 — binding TAKOSUMI_ACCOUNTS_DB.
output "accounts_d1_database_id" {
  description = "D1 database ID for the TAKOSUMI_ACCOUNTS_DB binding (account plane)."
  value       = cloudflare_d1_database.this["accounts"].id
}

output "accounts_d1_database_name" {
  description = "D1 database name for the TAKOSUMI_ACCOUNTS_DB binding (account plane)."
  value       = cloudflare_d1_database.this["accounts"].name
}

# Deploy-control D1 — binding TAKOS_D1.
output "deploy_d1_database_id" {
  description = "D1 database ID for the TAKOS_D1 binding (deploy-control run ledger)."
  value       = cloudflare_d1_database.this["deploy"].id
}

output "deploy_d1_database_name" {
  description = "D1 database name for the TAKOS_D1 binding (deploy-control run ledger)."
  value       = cloudflare_d1_database.this["deploy"].name
}

# All D1 database IDs keyed by logical binding (db, accounts, deploy).
output "d1_database_ids" {
  description = "D1 database IDs keyed by logical binding (db, accounts, deploy)."
  value       = { for k, v in cloudflare_d1_database.this : k => v.id }
}

output "kv_namespace_ids" {
  description = "KV namespace IDs keyed by logical binding (hostname_routing, rollout_health)."
  value       = { for k, v in cloudflare_workers_kv_namespace.this : k => v.id }
}

output "r2_bucket_names" {
  description = "R2 bucket names keyed by logical binding (incl. accounts_exports, artifacts)."
  value       = { for k, v in cloudflare_r2_bucket.this : k => v.name }
}

output "queue_names" {
  description = "Queue names keyed by logical binding (incl. *_dlq, control_plane, opentofu_runs)."
  value       = { for k, v in cloudflare_queue.this : k => v.queue_name }
}

output "vectorize_index_name" {
  description = "Expected Vectorize index name for the VECTORIZE binding (created out-of-band; not provider-managed)."
  value       = "${var.project_name}-embeddings"
}
