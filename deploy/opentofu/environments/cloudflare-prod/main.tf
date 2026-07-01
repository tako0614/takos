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

provider "cloudflare" {
  # Credentials are supplied outside the module by Takosumi ProviderConnection
  # env injection.
}

module "takos" {
  source = "../../modules/cloudflare"

  account_id   = var.account_id
  project_name = "takos"
  environment  = "production"
}

variable "account_id" {
  type = string
}

variable "release_working_directory" {
  type    = string
  default = "."
}

variable "takosumi_source_repo_url" {
  type    = string
  default = "https://github.com/tako0614/takosumi.git"
}

variable "takosumi_source_ref" {
  type    = string
  default = "main"
}

variable "manage_vectorize_index" {
  type    = bool
  default = true
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

output "d1_database_id" {
  value = module.takos.d1_database_id
}

output "d1_database_name" {
  value = module.takos.d1_database_name
}

output "accounts_d1_database_id" {
  value = module.takos.accounts_d1_database_id
}

output "deploy_d1_database_id" {
  value = module.takos.deploy_d1_database_id
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

output "takosumi_release" {
  description = "Operator-side release activation commands Takosumi should run after a successful apply."
  value = {
    post_apply = [
      {
        id                = "takos-worker-release"
        executor          = "runner"
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production"]
        working_directory = var.release_working_directory
        env = {
          TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
          TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          TAKOS_MANAGE_VECTORIZE_INDEX    = tostring(var.manage_vectorize_index)
        }
      },
    ]
    pre_destroy = [
      {
        id                = "takos-worker-destroy"
        executor          = "runner"
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production", "--destroy"]
        working_directory = var.release_working_directory
        env = {
          TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
          TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          TAKOS_MANAGE_VECTORIZE_INDEX    = tostring(var.manage_vectorize_index)
        }
      },
    ]
  }
}
