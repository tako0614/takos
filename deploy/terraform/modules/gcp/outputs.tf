output "database_connection_name" {
  description = "Cloud SQL instance connection name"
  value       = google_sql_database_instance.main.connection_name
}

output "database_url" {
  description = "PostgreSQL connection URL"
  value       = "postgresql://${google_sql_user.main.name}:${var.db_password}@/${google_sql_database.main.name}?host=/cloudsql/${google_sql_database_instance.main.connection_name}"
  sensitive   = true
}

output "redis_host" {
  description = "Memorystore Redis host"
  value       = google_redis_instance.main.host
}

output "redis_port" {
  description = "Memorystore Redis port"
  value       = google_redis_instance.main.port
}

output "redis_url" {
  description = "Redis connection URL"
  value       = "redis://${google_redis_instance.main.host}:${google_redis_instance.main.port}"
}

output "pubsub_topic_runs" {
  description = "Pub/Sub topic name for runs"
  value       = google_pubsub_topic.main["takos-runs"].name
}

output "pubsub_topic_index_jobs" {
  description = "Pub/Sub topic name for index jobs"
  value       = google_pubsub_topic.main["takos-index-jobs"].name
}

output "pubsub_topic_workflow_jobs" {
  description = "Pub/Sub topic name for workflow jobs"
  value       = google_pubsub_topic.main["takos-workflow-jobs"].name
}

output "pubsub_topic_deployment_jobs" {
  description = "Pub/Sub topic name for deployment jobs"
  value       = google_pubsub_topic.main["takos-deployment-jobs"].name
}

output "gcs_bucket_git_objects" {
  description = "GCS bucket name for git objects"
  value       = google_storage_bucket.main["git-objects"].name
}

output "gcs_bucket_offload" {
  description = "GCS bucket name for offload"
  value       = google_storage_bucket.main["offload"].name
}

output "gcs_bucket_tenant_source" {
  description = "GCS bucket name for tenant source"
  value       = google_storage_bucket.main["tenant-source"].name
}

output "gcs_bucket_worker_bundles" {
  description = "GCS bucket name for worker bundles"
  value       = google_storage_bucket.main["worker-bundles"].name
}

output "gcs_bucket_tenant_builds" {
  description = "GCS bucket name for tenant builds"
  value       = google_storage_bucket.main["tenant-builds"].name
}

output "gcs_bucket_ui_bundles" {
  description = "GCS bucket name for UI bundles"
  value       = google_storage_bucket.main["ui-bundles"].name
}

output "service_account_email" {
  description = "GKE workload service account email"
  value       = google_service_account.workload.email
}

output "vpc_id" {
  description = "VPC network ID"
  value       = google_compute_network.main.id
}

output "subnet_id" {
  description = "Subnet ID"
  value       = google_compute_subnetwork.main.id
}
