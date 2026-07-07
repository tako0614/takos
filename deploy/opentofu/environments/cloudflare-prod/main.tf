terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # State backend and provider credentials are resolved by Takosumi ProviderConnection / ProviderBinding / policy during the typed Run. Takosumi records StateVersion, Output, and audit/run evidence after a successful apply.
}

module "takos" {
  source = "../../modules/cloudflare"

  providers = {
    cloudflare = cloudflare
  }

  account_id   = var.account_id
  app_url      = var.app_url
  project_name = "takos"
  environment  = "production"
}

variable "account_id" {
  type = string
}

variable "app_url" {
  type    = string
  default = null

  validation {
    condition     = var.app_url == null || can(regex("^https://[^[:space:]]+$", var.app_url))
    error_message = "app_url must be unset or an https URL."
  }
}

variable "release_working_directory" {
  type    = string
  default = "."
}

variable "release_containers_rollout" {
  type    = string
  default = null

  validation {
    condition     = var.release_containers_rollout == null || contains(["immediate", "gradual", "none"], var.release_containers_rollout)
    error_message = "release_containers_rollout must be immediate, gradual, none, or null."
  }
}

variable "release_container_images" {
  type    = map(string)
  default = {}

  validation {
    condition = alltrue([
      for image in values(var.release_container_images) :
      can(regex("^(registry\\.cloudflare\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9._/-]+|docker\\.io/[A-Za-z0-9._/-]+|[0-9]{12}\\.dkr\\.ecr\\.[A-Za-z0-9-]+\\.amazonaws\\.com/[A-Za-z0-9._/-]+|[A-Za-z0-9-]+-docker\\.pkg\\.dev/[A-Za-z0-9._/-]+)(@sha256:[0-9a-f]{64}|:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$", image))
    ])
    error_message = "release_container_images values must use Cloudflare Containers-supported registry refs."
  }
}

variable "release_executor" {
  type    = string
  default = "operator"

  validation {
    condition     = contains(["runner", "operator"], var.release_executor)
    error_message = "release_executor must be runner or operator."
  }
}

variable "takosumi_source_repo_url" {
  type    = string
  default = "https://github.com/tako0614/takosumi.git"
}

variable "takosumi_source_ref" {
  type    = string
  default = "main"
}

output "target" {
  value = "cloudflare"
}

output "cloudflare_account_id" {
  value = var.account_id
}

output "worker_name" {
  value = module.takos.worker_name
}

output "url" {
  value = module.takos.launch_url
}

output "launch_url" {
  value = module.takos.launch_url
}

output "app_url" {
  value = module.takos.app_url
}

output "app_deployment" {
  description = "Installable Takos app declaration consumed from tofu output -json by Takosumi install flows."
  value       = module.takos.app_deployment
}

output "d1_database_id" {
  value = module.takos.d1_database_id
}

output "d1_database_name" {
  value = module.takos.d1_database_name
}

output "d1_database_ids" {
  value = module.takos.d1_database_ids
}

output "kv_namespace_ids" {
  value = module.takos.kv_namespace_ids
}

output "object_storage_buckets" {
  value = module.takos.r2_bucket_names
}

output "queue_bindings" {
  value = module.takos.queue_names
}

output "vectorize_index_name" {
  value = module.takos.vectorize_index_name
}

output "vectorize_index_dimensions" {
  value = module.takos.vectorize_index_dimensions
}

output "vectorize_index_metric" {
  value = module.takos.vectorize_index_metric
}

output "cloudflare_vectorize_index_name" {
  value = module.takos.vectorize_index_name
}

output "cloudflare_vectorize_index_dimensions" {
  value = module.takos.vectorize_index_dimensions
}

output "cloudflare_vectorize_index_metric" {
  value = module.takos.vectorize_index_metric
}

output "takosumi_release" {
  description = "Operator-side release activation commands Takosumi should run after a successful apply."
  value = {
    post_apply = [
      {
        id                = "takos-worker-release"
        executor          = var.release_executor
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production"]
        working_directory = var.release_working_directory
        timeout_seconds   = 1200
        env = merge(
          {
            TAKOS_RELEASE_TAKOSUMI_REPO_URL                = var.takosumi_source_repo_url
            TAKOS_RELEASE_TAKOSUMI_REF                     = var.takosumi_source_ref
            TAKOS_RELEASE_PRUNE_EXISTING_WORKER_MIGRATIONS = "1"
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
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production", "--destroy"]
        working_directory = var.release_working_directory
        timeout_seconds   = 600
        env = merge(
          {
            TAKOS_RELEASE_TAKOSUMI_REPO_URL                = var.takosumi_source_repo_url
            TAKOS_RELEASE_TAKOSUMI_REF                     = var.takosumi_source_ref
            TAKOS_RELEASE_PRUNE_EXISTING_WORKER_MIGRATIONS = "1"
          },
          var.release_containers_rollout == null ? {} : {
            TAKOS_WRANGLER_CONTAINERS_ROLLOUT = var.release_containers_rollout
          },
        )
      },
    ]
  }
}
