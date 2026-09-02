output "target" {
  description = "Selected deployment adapter."
  value       = "cloudflare"
}

# Cloudflare-specific binding map (Output consumed by the Worker-script layer).

output "cloudflare_account_id" {
  description = "Cloudflare account ID the resources were provisioned in (for the CF_ACCOUNT_ID worker var)."
  value       = module.platform.account_id
}

output "service_runtime_name" {
  description = "service runtime name rendered into wrangler.toml by the release activation step."
  value       = module.platform.service_runtime_name
}

output "url" {
  description = "Canonical public URL supplied through the required public_url input."
  value       = module.platform.launch_url
}

output "launch_url" {
  description = "Alias of url for Takosumi public output projection."
  value       = module.platform.launch_url
}

output "public_url" {
  description = "Canonical public Takos URL supplied through the required public_url input."
  value       = module.platform.public_url
}

output "cloudflare_workers_subdomain" {
  description = "workers.dev account subdomain used to derive the public Takos URL."
  value       = module.platform.workers_subdomain
}

output "workers_subdomain" {
  description = "Alias of cloudflare_workers_subdomain for generic release helpers."
  value       = module.platform.workers_subdomain
}

output "executor_capacity" {
  description = "Takos agent capacity consumed by the release renderer."
  value       = module.platform.executor_capacity
}

output "worker_env" {
  description = "Non-secret Takos Worker variables consumed by the Wrangler renderer. Runtime Interface declarations remain service-side Takosumi configuration."
  value       = module.platform.worker_env
}

output "cloudflare_d1_database_id" {
  description = "D1 database ID for the DB binding (cloudflare target)."
  value       = module.platform.d1_database_id
}

output "cloudflare_d1_database_name" {
  description = "D1 database name for the DB binding (cloudflare target)."
  value       = module.platform.d1_database_name
}

output "cloudflare_d1_database_ids" {
  description = "All D1 database IDs by logical binding: db (cloudflare target)."
  value       = module.platform.d1_database_ids
}

output "sql_databases" {
  description = "Provider-neutral SQL database identifiers keyed by logical binding."
  value       = module.platform.sql_databases
}

output "cloudflare_kv_namespace_ids" {
  description = "KV namespace IDs by logical binding (cloudflare target)."
  value       = module.platform.kv_namespace_ids
}

output "key_value_stores" {
  description = "Provider-neutral key-value store identifiers keyed by logical binding."
  value       = module.platform.key_value_stores
}

output "cloudflare_vectorize_index_name" {
  description = "Vectorize index name for the VECTORIZE binding (cloudflare target)."
  value       = module.platform.vectorize_index_name
}

output "cloudflare_vectorize_index_dimensions" {
  description = "Vector dimensions for the VECTORIZE binding (cloudflare target)."
  value       = module.platform.vectorize_index_dimensions
}

output "cloudflare_vectorize_index_metric" {
  description = "Vector distance metric for the VECTORIZE binding (cloudflare target)."
  value       = module.platform.vectorize_index_metric
}

output "vector_indexes" {
  description = "Provider-neutral vector index descriptors keyed by logical binding."
  value       = module.platform.vector_indexes
}

output "object_buckets" {
  description = "Provider-neutral object bucket names keyed by logical binding."
  value       = module.platform.object_buckets
}

output "queues" {
  description = "Provider-neutral queue names keyed by logical binding."
  value       = module.platform.queues
}

output "cloudflare_worker_id" {
  description = "Cloudflare Worker identity ID."
  value       = module.platform.worker_id
}

output "cloudflare_worker_version_id" {
  description = "Deployed Worker version ID."
  value       = module.platform.worker_version_id
}

output "cloudflare_worker_deployment_id" {
  description = "Cloudflare Worker deployment ID."
  value       = module.platform.worker_deployment_id
}

output "worker_artifact_digest" {
  description = "Stable digest of the Worker module and assets."
  value       = module.platform.worker_artifact_digest
}

output "vector_desired_config_digest" {
  description = "Stable digest of the Vectorize desired configuration."
  value       = module.platform.vector_desired_config_digest
}

output "container_desired_config_digest" {
  description = "Stable digest of the Container desired configuration."
  value       = module.platform.container_desired_config_digest
}

output "container_rendered_input_digest" {
  description = "Stable digest of the Container desired template and all values used to render it."
  value       = module.platform.container_rendered_input_digest
}

output "migration_set_digest" {
  description = "Stable digest of the D1 migration set."
  value       = module.platform.migration_set_digest
}

output "bridge_helper_digest" {
  description = "Stable digest of the optional provider-gap bridge executable."
  value       = module.platform.bridge_helper_digest
}

output "cloudflare_provider_gap_bridge_mode" {
  description = "Explicit Cloudflare provider-gap bridge mode: off, staging, or disposable-production."
  value       = module.platform.cloudflare_provider_gap_bridge_mode
}

output "runtime_secret_binding_names" {
  description = "Exact operator-owned runtime secret binding names the Takos Worker requires. This module never holds their values."
  value       = module.platform.runtime_secret_binding_names
}

output "runtime_secrets_provisioned" {
  description = "Whether the Worker Version carries the runtime secret bindings forward with the inherit binding type."
  value       = module.platform.runtime_secrets_provisioned
}
