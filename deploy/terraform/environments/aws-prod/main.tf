terraform {
  required_version = ">= 1.5"

  backend "s3" {
    bucket = "takos-terraform-state"
    key    = "aws-prod/terraform.tfstate"
    region = "ap-northeast-1"
  }
}

module "takos" {
  source = "../../modules/aws"

  region              = var.region
  project_name        = "takos"
  environment         = "production"
  vpc_cidr            = "10.0.0.0/16"
  db_instance_class   = "db.t4g.medium"
  db_allocated_storage = 50
  db_username         = "takos"
  db_password         = var.db_password
  redis_node_type     = "cache.t4g.medium"
  s3_bucket_prefix    = "takos-prod"
  dynamo_kv_table_name = "takos-prod-kv"

  tags = {
    Project     = "takos"
    Environment = "production"
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
  value = module.takos.sqs_run_queue_url
}

output "sqs_index_queue_url" {
  value = module.takos.sqs_index_queue_url
}

output "sqs_workflow_queue_url" {
  value = module.takos.sqs_workflow_queue_url
}

output "sqs_deployment_queue_url" {
  value = module.takos.sqs_deployment_queue_url
}
