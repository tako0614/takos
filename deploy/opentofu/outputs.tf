output "target" {
  description = "Selected cloud target."
  value       = var.target
}

output "database_endpoint" {
  description = "Non-secret database endpoint or cloud connection name for the selected target."
  value = var.target == "aws" ? module.aws[0].database_endpoint : (
    var.target == "gcp" ? module.gcp[0].database_endpoint : null
  )
}

output "database_url" {
  description = "PostgreSQL connection URL for the selected target."
  value = var.target == "aws" ? module.aws[0].database_url : (
    var.target == "gcp" ? module.gcp[0].database_url : null
  )
  sensitive = true
}

output "redis_url" {
  description = "Redis connection URL for the selected target."
  value = var.target == "aws" ? module.aws[0].redis_url : (
    var.target == "gcp" ? module.gcp[0].redis_url : null
  )
}

output "queue_bindings" {
  description = "Queue or topic bindings for Takos control-plane jobs."
  value = var.target == "aws" ? tomap({
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
}

output "object_storage_buckets" {
  description = "Object storage buckets for Git, bundles, builds, and offload data."
  value = var.target == "aws" ? tomap({
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
}

output "network" {
  description = "Network identifiers for the selected target."
  value = var.target == "aws" ? tomap({
    vpc_id             = module.aws[0].vpc_id
    private_subnet_ids = join(",", module.aws[0].private_subnet_ids)
    public_subnet_ids  = join(",", module.aws[0].public_subnet_ids)
    }) : tomap({
    vpc_id    = module.gcp[0].vpc_id
    subnet_id = module.gcp[0].subnet_id
  })
}

output "workload_identity" {
  description = "Workload identity outputs for application runtime permissions."
  value = var.target == "aws" ? tomap({
    ecs_task_execution_role_arn = module.aws[0].ecs_task_execution_role_arn
    ecs_task_role_arn           = module.aws[0].ecs_task_role_arn
    }) : tomap({
    service_account_email = module.gcp[0].service_account_email
  })
}
