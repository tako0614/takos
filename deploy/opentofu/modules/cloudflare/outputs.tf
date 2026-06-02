# DeploymentOutput surface: non-secret resource IDs/names that the Worker-script
# layer (and Takosumi's Deployment record) consume as the binding map.

output "d1_database_id" {
  description = "D1 database ID for the DB binding."
  value       = cloudflare_d1_database.main.id
}

output "d1_database_name" {
  description = "D1 database name for the DB binding."
  value       = cloudflare_d1_database.main.name
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
  description = "Queue names keyed by logical binding."
  value       = { for k, v in cloudflare_queue.this : k => v.queue_name }
}

output "vectorize_index_name" {
  description = "Expected Vectorize index name for the VECTORIZE binding (created out-of-band; not provider-managed)."
  value       = "${var.project_name}-embeddings"
}
