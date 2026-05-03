################################################################################
# Database
################################################################################

output "database_url" {
  description = "PostgreSQL connection string"
  value       = "postgresql://${var.db_username}:${var.db_password}@${aws_db_instance.main.endpoint}/${var.project_name}"
  sensitive   = true
}

################################################################################
# Redis
################################################################################

output "redis_url" {
  description = "Redis connection string"
  value       = "redis://${aws_elasticache_cluster.main.cache_nodes[0].address}:${aws_elasticache_cluster.main.cache_nodes[0].port}"
}

################################################################################
# SQS Queue URLs
################################################################################

output "sqs_runs_queue_url" {
  description = "SQS queue URL for takos-runs"
  value       = aws_sqs_queue.main["takos-runs"].url
}

output "sqs_index_jobs_queue_url" {
  description = "SQS queue URL for takos-index-jobs"
  value       = aws_sqs_queue.main["takos-index-jobs"].url
}

output "sqs_workflow_jobs_queue_url" {
  description = "SQS queue URL for takos-workflow-jobs"
  value       = aws_sqs_queue.main["takos-workflow-jobs"].url
}

output "sqs_deployment_jobs_queue_url" {
  description = "SQS queue URL for takos-deployment-jobs"
  value       = aws_sqs_queue.main["takos-deployment-jobs"].url
}

################################################################################
# S3 Bucket Names
################################################################################

output "s3_git_objects_bucket" {
  description = "S3 bucket name for git objects"
  value       = aws_s3_bucket.main["git-objects"].id
}

output "s3_offload_bucket" {
  description = "S3 bucket name for offload storage"
  value       = aws_s3_bucket.main["offload"].id
}

output "s3_tenant_source_bucket" {
  description = "S3 bucket name for tenant source"
  value       = aws_s3_bucket.main["tenant-source"].id
}

output "s3_worker_bundles_bucket" {
  description = "S3 bucket name for worker bundles"
  value       = aws_s3_bucket.main["worker-bundles"].id
}

output "s3_tenant_builds_bucket" {
  description = "S3 bucket name for tenant builds"
  value       = aws_s3_bucket.main["tenant-builds"].id
}

output "s3_ui_bundles_bucket" {
  description = "S3 bucket name for UI bundles"
  value       = aws_s3_bucket.main["ui-bundles"].id
}

################################################################################
# DynamoDB
################################################################################

output "dynamodb_kv_table_name" {
  description = "DynamoDB KV table name"
  value       = aws_dynamodb_table.kv.name
}

################################################################################
# VPC / Networking
################################################################################

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = aws_subnet.private[*].id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = aws_subnet.public[*].id
}

################################################################################
# IAM
################################################################################

output "ecs_task_execution_role_arn" {
  description = "ARN of the ECS task execution IAM role"
  value       = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  description = "ARN of the ECS task IAM role (application permissions)"
  value       = aws_iam_role.ecs_task.arn
}
