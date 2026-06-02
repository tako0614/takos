terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "takos-opentofu-state"
    key    = "aws-prod/opentofu.tfstate"
    region = "ap-northeast-1"
  }
}

provider "aws" {
  region = var.region
}

module "takos" {
  source = "../../modules/aws"

  region               = var.region
  project_name         = "takos"
  environment          = "production"
  vpc_cidr             = "10.0.0.0/16"
  db_instance_class    = "db.t4g.medium"
  db_allocated_storage = 50
  db_username          = "takos"
  db_password          = var.db_password
  redis_node_type      = "cache.t4g.medium"
  s3_bucket_prefix     = "takos-prod"
  dynamo_kv_table_name = "takos-prod-kv"

  tags = {
    Project     = "takos"
    Environment = "production"
    ManagedBy   = "opentofu"
  }
}

variable "region" {
  type    = string
  default = "ap-northeast-1"
}

variable "db_password" {
  type      = string
  sensitive = true
}

output "target" {
  value = "aws"
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

output "sqs_run_queue_url" {
  value = module.takos.sqs_runs_queue_url
}

output "sqs_index_queue_url" {
  value = module.takos.sqs_index_jobs_queue_url
}

output "sqs_workflow_queue_url" {
  value = module.takos.sqs_workflow_jobs_queue_url
}

output "sqs_deployment_queue_url" {
  value = module.takos.sqs_deployment_jobs_queue_url
}

output "queue_bindings" {
  value = {
    runs       = module.takos.sqs_runs_queue_url
    index      = module.takos.sqs_index_jobs_queue_url
    workflow   = module.takos.sqs_workflow_jobs_queue_url
    deployment = module.takos.sqs_deployment_jobs_queue_url
  }
}

output "object_storage_buckets" {
  value = {
    git_objects    = module.takos.s3_git_objects_bucket
    offload        = module.takos.s3_offload_bucket
    tenant_source  = module.takos.s3_tenant_source_bucket
    worker_bundles = module.takos.s3_worker_bundles_bucket
    tenant_builds  = module.takos.s3_tenant_builds_bucket
    ui_bundles     = module.takos.s3_ui_bundles_bucket
  }
}

output "network" {
  value = {
    vpc_id             = module.takos.vpc_id
    private_subnet_ids = module.takos.private_subnet_ids
    public_subnet_ids  = module.takos.public_subnet_ids
  }
}

output "workload_identity" {
  value = {
    ecs_task_execution_role_arn = module.takos.ecs_task_execution_role_arn
    ecs_task_role_arn           = module.takos.ecs_task_role_arn
  }
}
