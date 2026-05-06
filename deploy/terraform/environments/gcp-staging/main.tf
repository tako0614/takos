terraform {
  required_version = ">= 1.5"

  backend "gcs" {
    bucket = "takos-terraform-state"
    prefix = "gcp-staging"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "takos" {
  source = "../../modules/gcp"

  project_id           = var.project_id
  region               = var.region
  project_name         = "takos"
  environment          = "staging"
  db_tier              = "db-custom-1-3840"
  db_disk_size         = 20
  db_password          = var.db_password
  redis_memory_size_gb = 1
  redis_tier           = "BASIC"
  gcs_bucket_prefix    = "takos-staging"
  gcs_location         = "ASIA-NORTHEAST1"

  labels = {
    project     = "takos"
    environment = "staging"
    managed-by  = "terraform"
  }
}

variable "project_id" {
  type = string
}

variable "region" {
  type    = string
  default = "asia-northeast1"
}

variable "db_password" {
  type      = string
  sensitive = true
}

output "database_url" {
  value     = module.takos.database_url
  sensitive = true
}

output "redis_url" {
  value = module.takos.redis_url
}

output "pubsub_run_topic" {
  value = module.takos.pubsub_topic_runs
}

output "pubsub_index_topic" {
  value = module.takos.pubsub_topic_index_jobs
}

output "pubsub_workflow_topic" {
  value = module.takos.pubsub_topic_workflow_jobs
}

output "pubsub_deployment_topic" {
  value = module.takos.pubsub_topic_deployment_jobs
}
