terraform {
  required_version = ">= 1.5"

  backend "gcs" {
    bucket = "takos-terraform-state"
    prefix = "gcp-prod"
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
  environment          = "production"
  db_tier              = "db-custom-2-8192"
  db_disk_size         = 50
  db_password          = var.db_password
  redis_memory_size_gb = 1
  redis_tier           = "BASIC"
  gcs_bucket_prefix    = "takos-prod"
  gcs_location         = "ASIA-NORTHEAST1"

  labels = {
    project     = "takos"
    environment = "production"
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

output "target" {
  value = "gcp"
}

output "database_endpoint" {
  value = module.takos.database_endpoint
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

output "queue_bindings" {
  value = {
    runs       = module.takos.pubsub_topic_runs
    index      = module.takos.pubsub_topic_index_jobs
    workflow   = module.takos.pubsub_topic_workflow_jobs
    deployment = module.takos.pubsub_topic_deployment_jobs
  }
}

output "object_storage_buckets" {
  value = {
    git_objects    = module.takos.gcs_bucket_git_objects
    offload        = module.takos.gcs_bucket_offload
    tenant_source  = module.takos.gcs_bucket_tenant_source
    worker_bundles = module.takos.gcs_bucket_worker_bundles
    tenant_builds  = module.takos.gcs_bucket_tenant_builds
    ui_bundles     = module.takos.gcs_bucket_ui_bundles
  }
}

output "network" {
  value = {
    vpc_id    = module.takos.vpc_id
    subnet_id = module.takos.subnet_id
  }
}

output "workload_identity" {
  value = {
    service_account_email = module.takos.service_account_email
  }
}
