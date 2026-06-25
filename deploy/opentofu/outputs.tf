output "target" {
  description = "Selected cloud target."
  value       = var.target
}

output "database_endpoint" {
  description = "Non-secret D1 database id for the selected target."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : null
}

# Cloudflare-specific binding map (OutputSnapshot consumed by the Worker-script layer).

output "cloudflare_account_id" {
  description = "Cloudflare account ID the resources were provisioned in (for the CF_ACCOUNT_ID worker var)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].account_id : null
}

output "cloudflare_d1_database_id" {
  description = "D1 database ID for the DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : null
}

output "cloudflare_accounts_d1_database_id" {
  description = "D1 database ID for the TAKOSUMI_ACCOUNTS_DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].accounts_d1_database_id : null
}

output "cloudflare_deploy_d1_database_id" {
  description = "D1 database ID for the TAKOSUMI_CONTROL_DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].deploy_d1_database_id : null
}

output "cloudflare_d1_database_ids" {
  description = "All D1 database IDs by logical binding: db, accounts, deploy (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_ids : null
}

output "cloudflare_kv_namespace_ids" {
  description = "KV namespace IDs by logical binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].kv_namespace_ids : null
}

output "cloudflare_vectorize_index_name" {
  description = "Vectorize index name for the VECTORIZE binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_name : null
}

output "object_storage_buckets" {
  description = "R2 bucket names for Git, bundles, builds, and offload data."
  value       = var.target == "cloudflare" ? module.cloudflare[0].r2_bucket_names : null
}

output "queue_bindings" {
  description = "Queue bindings for Takos product jobs (runs, index, workflow, deployment)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].queue_names : null
}

output "takosumi_release" {
  description = "Operator-side release activation commands Takosumi should run after a successful apply."
  value = {
    post_apply = [
      {
        id                = "takos-worker-release"
        executor          = "operator"
        command           = ["bun", "scripts/control/takosumi-release.mjs", var.environment]
        working_directory = "."
      },
    ]
  }
}
