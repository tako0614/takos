terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # State backend is owned by the Takosumi RunnerProfile; Takosumi records the
  # PlanRun / ApplyRun and the resulting Deployment + DeploymentOutput. The
  # backend block is supplied by the runner profile at apply time.
}

provider "cloudflare" {
  # Real credential is supplied by Takosumi's RunnerProfile (CLOUDFLARE_API_TOKEN).
  api_token = var.api_token
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

variable "api_token" {
  type      = string
  sensitive = true
  default   = null
}

output "target" {
  value = "cloudflare"
}

output "d1_database_id" {
  value = module.takos.d1_database_id
}

output "d1_database_name" {
  value = module.takos.d1_database_name
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
