terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region                      = var.aws.region
  skip_credentials_validation = var.opentofu_plan_mode
  skip_metadata_api_check     = var.opentofu_plan_mode
  skip_requesting_account_id  = var.opentofu_plan_mode
}

provider "google" {
  project      = var.gcp.project_id
  region       = var.gcp.region
  access_token = var.opentofu_plan_mode ? "mock-token-for-plan-only" : null
}

module "aws" {
  count  = var.target == "aws" ? 1 : 0
  source = "./modules/aws"

  region                = var.aws.region
  project_name          = var.project_name
  environment           = var.environment
  vpc_cidr              = var.aws.vpc_cidr
  db_instance_class     = var.aws.db_instance_class
  db_allocated_storage  = var.aws.db_allocated_storage
  db_username           = var.db_username
  db_password           = var.db_password
  redis_node_type       = var.aws.redis_node_type
  redis_num_cache_nodes = var.aws.redis_num_cache_nodes
  s3_bucket_prefix      = var.aws.s3_bucket_prefix
  sqs_message_retention = var.aws.sqs_message_retention
  dynamo_kv_table_name  = var.aws.dynamo_kv_table_name
  ecs_cluster_name      = var.aws.ecs_cluster_name
  plan_mode             = var.opentofu_plan_mode
  aws_account_id        = var.opentofu_plan_mode ? "000000000000" : ""
  availability_zones    = var.opentofu_plan_mode ? ["${var.aws.region}a", "${var.aws.region}c"] : []

  tags = merge(
    {
      Project     = var.project_name
      Environment = var.environment
      ManagedBy   = "opentofu"
    },
    var.aws.tags,
  )
}

module "gcp" {
  count  = var.target == "gcp" ? 1 : 0
  source = "./modules/gcp"

  project_id           = var.gcp.project_id
  region               = var.gcp.region
  project_name         = var.project_name
  environment          = var.environment
  db_tier              = var.gcp.db_tier
  db_disk_size         = var.gcp.db_disk_size
  db_password          = var.db_password
  redis_memory_size_gb = var.gcp.redis_memory_size_gb
  redis_tier           = var.gcp.redis_tier
  gcs_bucket_prefix    = var.gcp.gcs_bucket_prefix
  gcs_location         = var.gcp.gcs_location

  labels = merge(
    {
      project     = var.project_name
      environment = var.environment
      managed_by  = "opentofu"
    },
    var.gcp.labels,
  )
}
