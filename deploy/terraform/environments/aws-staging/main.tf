terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "takos-terraform-state"
    key    = "aws-staging/terraform.tfstate"
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
  environment          = "staging"
  vpc_cidr             = "10.10.0.0/16"
  db_instance_class    = "db.t4g.micro"
  db_allocated_storage = 20
  db_username          = "takos"
  db_password          = var.db_password
  redis_node_type      = "cache.t4g.micro"
  s3_bucket_prefix     = "takos-staging"
  dynamo_kv_table_name = "takos-staging-kv"

  tags = {
    Project     = "takos"
    Environment = "staging"
    ManagedBy   = "terraform"
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
