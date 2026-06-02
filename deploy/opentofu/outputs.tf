output "target" {
  description = "Selected cloud target."
  value       = var.target
}

output "database_endpoint" {
  description = "Non-secret database endpoint / connection name / D1 id for the selected target."
  value = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : (
    var.target == "aws" ? module.aws[0].database_endpoint : (
      var.target == "gcp" ? module.gcp[0].database_endpoint : null
    )
  )
}

output "database_url" {
  description = "PostgreSQL connection URL (aws/gcp). Null for cloudflare (D1 uses a binding, not a URL)."
  value = var.target == "cloudflare" ? null : (
    var.target == "aws" ? module.aws[0].database_url : (
      var.target == "gcp" ? module.gcp[0].database_url : null
    )
  )
  sensitive = true
}

output "redis_url" {
  description = "Redis connection URL (aws/gcp). Null for cloudflare."
  value = var.target == "cloudflare" ? null : (
    var.target == "aws" ? module.aws[0].redis_url : (
      var.target == "gcp" ? module.gcp[0].redis_url : null
    )
  )
}

output "queue_bindings" {
  description = "Queue / topic bindings for Takos control-plane jobs (runs, index, workflow, deployment)."
  value = var.target == "cloudflare" ? module.cloudflare[0].queue_names : (
    var.target == "aws" ? tomap({
      runs       = module.aws[0].sqs_runs_queue_url
      index      = module.aws[0].sqs_index_jobs_queue_url
      workflow   = module.aws[0].sqs_workflow_jobs_queue_url
      deployment = module.aws[0].sqs_deployment_jobs_queue_url
      }) : tomap({
      runs       = module.gcp[0].pubsub_topic_runs
      index      = module.gcp[0].pubsub_topic_index_jobs
      workflow   = module.gcp[0].pubsub_topic_workflow_jobs
      deployment = module.gcp[0].pubsub_topic_deployment_jobs
    })
  )
}

output "object_storage_buckets" {
  description = "Object storage buckets / R2 bucket names for Git, bundles, builds, and offload data."
  value = var.target == "cloudflare" ? module.cloudflare[0].r2_bucket_names : (
    var.target == "aws" ? tomap({
      git_objects    = module.aws[0].s3_git_objects_bucket
      offload        = module.aws[0].s3_offload_bucket
      tenant_source  = module.aws[0].s3_tenant_source_bucket
      worker_bundles = module.aws[0].s3_worker_bundles_bucket
      tenant_builds  = module.aws[0].s3_tenant_builds_bucket
      ui_bundles     = module.aws[0].s3_ui_bundles_bucket
      }) : tomap({
      git_objects    = module.gcp[0].gcs_bucket_git_objects
      offload        = module.gcp[0].gcs_bucket_offload
      tenant_source  = module.gcp[0].gcs_bucket_tenant_source
      worker_bundles = module.gcp[0].gcs_bucket_worker_bundles
      tenant_builds  = module.gcp[0].gcs_bucket_tenant_builds
      ui_bundles     = module.gcp[0].gcs_bucket_ui_bundles
    })
  )
}

output "network" {
  description = "Network identifiers (aws/gcp). Null for cloudflare (no VPC; edge network)."
  value = var.target == "cloudflare" ? null : (
    var.target == "aws" ? tomap({
      vpc_id             = module.aws[0].vpc_id
      private_subnet_ids = join(",", module.aws[0].private_subnet_ids)
      public_subnet_ids  = join(",", module.aws[0].public_subnet_ids)
      }) : tomap({
      vpc_id    = module.gcp[0].vpc_id
      subnet_id = module.gcp[0].subnet_id
    })
  )
}

output "workload_identity" {
  description = "Workload identity outputs for application runtime permissions (aws/gcp). Null for cloudflare."
  value = var.target == "cloudflare" ? null : (
    var.target == "aws" ? tomap({
      ecs_task_execution_role_arn = module.aws[0].ecs_task_execution_role_arn
      ecs_task_role_arn           = module.aws[0].ecs_task_role_arn
      }) : tomap({
      service_account_email = module.gcp[0].service_account_email
    })
  )
}

# Cloudflare-specific binding map (DeploymentOutput consumed by the Worker-script layer).

output "cloudflare_d1_database_id" {
  description = "D1 database ID for the DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : null
}

output "cloudflare_kv_namespace_ids" {
  description = "KV namespace IDs by logical binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].kv_namespace_ids : null
}

output "cloudflare_vectorize_index_name" {
  description = "Vectorize index name for the VECTORIZE binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_name : null
}
