output "target" {
  description = "Selected cloud target."
  value       = var.target
}

output "database_endpoint" {
  description = "Non-secret D1 database id for the selected target."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : null
}

# Cloudflare-specific binding map (Output consumed by the Worker-script layer).

output "cloudflare_account_id" {
  description = "Cloudflare account ID the resources were provisioned in (for the CF_ACCOUNT_ID worker var)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].account_id : null
}

output "service_runtime_name" {
  description = "service runtime name rendered into wrangler.toml by the release activation step."
  value       = var.target == "cloudflare" ? module.cloudflare[0].service_runtime_name : null
}

output "url" {
  description = "Public URL for smoke checks when public_url or cloudflare.workers_subdomain is supplied."
  value       = var.target == "cloudflare" ? module.cloudflare[0].launch_url : null
}

output "launch_url" {
  description = "Alias of url for Takosumi public output projection."
  value       = var.target == "cloudflare" ? module.cloudflare[0].launch_url : null
}

output "public_url" {
  description = "Canonical public Takos URL projected from public_url or the derived workers.dev URL."
  value       = var.target == "cloudflare" ? module.cloudflare[0].public_url : null
}

output "cloudflare_workers_subdomain" {
  description = "workers.dev account subdomain used to derive the public Takos URL."
  value       = var.target == "cloudflare" ? module.cloudflare[0].workers_subdomain : null
}

output "workers_subdomain" {
  description = "Alias of cloudflare_workers_subdomain for generic release helpers."
  value       = var.target == "cloudflare" ? module.cloudflare[0].workers_subdomain : null
}

output "app_deployment" {
  description = "Installable Takos app declaration consumed from tofu output -json by Takosumi install flows."
  value       = var.target == "cloudflare" ? module.cloudflare[0].app_deployment : null
}

output "cloudflare_d1_database_id" {
  description = "D1 database ID for the DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : null
}

output "cloudflare_d1_database_ids" {
  description = "All D1 database IDs by logical binding: db (cloudflare target)."
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

output "cloudflare_vectorize_index_dimensions" {
  description = "Vector dimensions for the VECTORIZE binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_dimensions : null
}

output "cloudflare_vectorize_index_metric" {
  description = "Vector distance metric for the VECTORIZE binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_metric : null
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
        executor          = var.release_executor
        command           = ["bun", "scripts/control/takosumi-release.mjs", var.environment]
        working_directory = var.release_working_directory
        timeout_seconds   = 1200
        env = merge(
          {
            TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
            TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          },
          var.release_containers_rollout == null ? {} : {
            TAKOS_WRANGLER_CONTAINERS_ROLLOUT = var.release_containers_rollout
          },
          var.release_executor == "operator" ? {
            TAKOS_REQUIRE_PREBUILT_CONTAINER_IMAGES = "1"
          } : {},
          length(var.release_container_images) == 0 ? {} : {
            TAKOS_RELEASE_CONTAINER_IMAGES_JSON = jsonencode(var.release_container_images)
          },
        )
      },
    ]
    pre_destroy = [
      {
        id                = "takos-worker-destroy"
        executor          = var.release_executor
        command           = ["bun", "scripts/control/takosumi-release.mjs", var.environment, "--destroy"]
        working_directory = var.release_working_directory
        timeout_seconds   = 600
        env = merge(
          {
            TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
            TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          },
          var.release_containers_rollout == null ? {} : {
            TAKOS_WRANGLER_CONTAINERS_ROLLOUT = var.release_containers_rollout
          },
        )
      },
    ]
  }
}
