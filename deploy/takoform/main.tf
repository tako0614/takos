terraform {
  required_version = ">= 1.5"

  required_providers {
    takoform = {
      source  = "registry.opentofu.org/tako0614/takoform"
      version = "= 1.0.3"
    }
  }
}

variable "project_name" {
  description = "Portable resource-name prefix for this Takos instance."
  type        = string
  default     = "takos"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,50}[a-z0-9]$", var.project_name))
    error_message = "project_name must be 3-52 lowercase letters, numbers, or hyphens, and start/end with an alphanumeric character."
  }
}

variable "worker_release_tag" {
  description = "Takos GitHub release containing the immutable Worker archive."
  type        = string
  default     = "v0.11.20"
}

variable "worker_artifact_url" {
  description = "Immutable Takos Worker archive URL."
  type        = string
  default     = "https://github.com/tako0614/takos/releases/download/v0.11.20/takos-worker-release.tar.gz"
}

variable "worker_artifact_sha256" {
  description = "Expected SHA-256 of worker_artifact_url."
  type        = string
  default     = "sha256:d8dfe350d9465f8d99bca57ff3bb75473b0ac1aa7e2a1f1c3acb66c518dd34af"
}

variable "runtime_image" {
  description = "Digest-pinned OCI image for the Takos tool runtime service."
  type        = string

  validation {
    condition     = can(regex("^[^[:space:]@]+@sha256:[a-f0-9]{64}$", trimspace(var.runtime_image)))
    error_message = "runtime_image must be a digest-pinned OCI image reference."
  }
}

variable "executor_image" {
  description = "Digest-pinned OCI image for the Takos agent executor service."
  type        = string

  validation {
    condition     = can(regex("^[^[:space:]@]+@sha256:[a-f0-9]{64}$", trimspace(var.executor_image)))
    error_message = "executor_image must be a digest-pinned OCI image reference."
  }
}

variable "public_url" {
  description = "Optional canonical public URL."
  type        = string
  default     = ""
}

variable "takosumi_accounts_url" {
  description = "Takosumi Accounts base URL."
  type        = string
  default     = ""
}

variable "takosumi_accounts_issuer_url" {
  description = "OIDC issuer URL used by Takos."
  type        = string
  default     = ""
}

variable "takosumi_accounts_client_id" {
  description = "OIDC client id used by Takos."
  type        = string
  default     = ""
}

variable "takosumi_accounts_redirect_uri" {
  description = "OIDC callback URL."
  type        = string
  default     = ""
}

variable "env" {
  description = "Additional non-secret application configuration."
  type        = map(string)
  default     = {}
  sensitive   = true
}

locals {
  prefix          = var.project_name
  artifact_url    = trimspace(var.worker_artifact_url)
  artifact_sha256 = startswith(trimspace(var.worker_artifact_sha256), "sha256:") ? trimspace(var.worker_artifact_sha256) : format("sha256:%s", trimspace(var.worker_artifact_sha256))
  buckets = {
    worker_bundles = "worker-bundles"
    tenant_builds  = "tenant-builds"
    tenant_source  = "tenant-source"
    git_objects    = "git-objects"
    offload        = "offload"
  }
  queues = {
    runs                  = "runs"
    runs_dlq              = "runs-dlq"
    index_jobs            = "index-jobs"
    index_jobs_dlq        = "index-jobs-dlq"
    workflow_jobs         = "workflow-jobs"
    workflow_jobs_dlq     = "workflow-jobs-dlq"
    notification_push     = "notification-push"
    notification_push_dlq = "notification-push-dlq"
  }
  stateful_entities = {
    session               = { class = "SessionDO", migration = "v1" }
    run_notifier          = { class = "RunNotifierDO", migration = "v2" }
    rate_limiter          = { class = "RateLimiterDO", migration = "v3" }
    notification_notifier = { class = "NotificationNotifierDO", migration = "v4" }
    routing               = { class = "RoutingDO", migration = "v5" }
  }
  configuration = merge(
    { for name, value in var.env : name => value if trimspace(value) != "" },
    trimspace(var.public_url) != "" ? {
      ADMIN_DOMAIN         = replace(trimspace(var.public_url), "https://", "")
      TENANT_BASE_DOMAIN   = replace(trimspace(var.public_url), "https://", "")
      AUTH_PUBLIC_BASE_URL = trimspace(var.public_url)
      PROXY_BASE_URL       = trimspace(var.public_url)
    } : {},
    trimspace(var.takosumi_accounts_url) != "" ? {
      TAKOSUMI_ACCOUNTS_URL = trimspace(var.takosumi_accounts_url)
    } : {},
    trimspace(var.takosumi_accounts_issuer_url) != "" ? {
      OIDC_ISSUER_URL = trimspace(var.takosumi_accounts_issuer_url)
    } : {},
    trimspace(var.takosumi_accounts_client_id) != "" ? {
      OIDC_CLIENT_ID = trimspace(var.takosumi_accounts_client_id)
    } : {},
    trimspace(var.takosumi_accounts_redirect_uri) != "" ? {
      OIDC_REDIRECT_URI = trimspace(var.takosumi_accounts_redirect_uri)
    } : {},
  )
}

resource "takoform_relational_database" "database" {
  name   = format("%s-db", local.prefix)
  engine = "sqlite"
}

resource "takoform_key_value_store" "hostname_routing" {
  name        = format("%s-hostname-routing", local.prefix)
  consistency = "eventual"
}

resource "takoform_object_bucket" "buckets" {
  for_each      = local.buckets
  name          = format("%s-%s", local.prefix, each.value)
  storage_class = "standard"
}

resource "takoform_queue" "queues" {
  for_each    = local.queues
  name        = format("%s-%s", local.prefix, each.value)
  max_retries = endswith(each.key, "_dlq") ? 100 : 5
}

resource "takoform_vector_index" "embeddings" {
  name       = format("%s-embeddings", local.prefix)
  dimensions = 768
  metric     = "cosine"
}

resource "takoform_stateful_entity" "entities" {
  for_each            = local.stateful_entities
  name                = format("%s-%s", local.prefix, replace(each.key, "_", "-"))
  artifact_media_type = "application/gzip"
  artifact_sha256     = local.artifact_sha256
  artifact_url        = local.artifact_url
  entity_class        = each.value.class
  runtime             = "javascript"
  runtime_version     = "2026.1"
  persistence         = "transactional"
  migration_tag       = each.value.migration
}

resource "takoform_container_service" "runtime" {
  name              = format("%s-runtime", local.prefix)
  image             = var.runtime_image
  ports             = [8080]
  public_http       = false
  cpu_millicores    = 500
  memory_mib        = 1024
  replicas          = 1
  health_check_path = "/health"
}

resource "takoform_container_service" "executors" {
  for_each = {
    tier_1 = { cpu = 250, memory = 512 }
    tier_2 = { cpu = 500, memory = 1024 }
    tier_3 = { cpu = 1000, memory = 12288 }
  }
  name              = format("%s-executor-%s", local.prefix, replace(each.key, "_", "-"))
  image             = var.executor_image
  ports             = [8789]
  public_http       = false
  cpu_millicores    = each.value.cpu
  memory_mib        = each.value.memory
  replicas          = 1
  health_check_path = "/health"
}

resource "takoform_edge_worker" "app" {
  name                      = local.prefix
  artifact_url              = local.artifact_url
  artifact_sha256           = local.artifact_sha256
  artifact_media_type       = "application/gzip"
  entrypoint                = "worker/index.js"
  runtime                   = "javascript"
  runtime_version           = "2026.1"
  assets_path               = "assets"
  assets_not_found_handling = "single_page_application"
  configuration             = local.configuration

  connections = concat(
    [
      { name = "DB", resource = takoform_relational_database.database.id, permissions = ["connect", "read", "write"], projection = "sql.binding.v1" },
      { name = "HOSTNAME_ROUTING", resource = takoform_key_value_store.hostname_routing.id, permissions = ["read", "write"], projection = "keyvalue.binding.v1" },
      { name = "VECTORIZE", resource = takoform_vector_index.embeddings.id, permissions = ["read", "write"], projection = "vector.binding.v1" },
      { name = "RUNTIME_CONTAINER", resource = takoform_container_service.runtime.id, permissions = ["invoke"], projection = "service.binding.v1" },
      { name = "EXECUTOR_CONTAINER", resource = takoform_container_service.executors["tier_1"].id, permissions = ["invoke"], projection = "service.binding.v1" },
      { name = "EXECUTOR_CONTAINER_TIER2", resource = takoform_container_service.executors["tier_2"].id, permissions = ["invoke"], projection = "service.binding.v1" },
      { name = "EXECUTOR_CONTAINER_TIER3", resource = takoform_container_service.executors["tier_3"].id, permissions = ["invoke"], projection = "service.binding.v1" },
    ],
    [for key, resource in takoform_object_bucket.buckets : {
      name = {
        worker_bundles = "WORKER_BUNDLES"
        tenant_builds  = "TENANT_BUILDS"
        tenant_source  = "TENANT_SOURCE"
        git_objects    = "GIT_OBJECTS"
        offload        = "TAKOS_OFFLOAD"
      }[key]
      resource    = resource.id
      permissions = ["read", "write"]
      projection  = "object.binding.v1"
    }],
    [for key, resource in takoform_queue.queues : {
      name = {
        runs                  = "RUN_QUEUE"
        runs_dlq              = "RUN_QUEUE_DLQ"
        index_jobs            = "INDEX_QUEUE"
        index_jobs_dlq        = "INDEX_QUEUE_DLQ"
        workflow_jobs         = "WORKFLOW_QUEUE"
        workflow_jobs_dlq     = "WORKFLOW_QUEUE_DLQ"
        notification_push     = "TAKOS_NOTIFICATION_PUSH_QUEUE"
        notification_push_dlq = "TAKOS_NOTIFICATION_PUSH_DLQ"
      }[key]
      resource    = resource.id
      permissions = ["consume", "publish"]
      projection  = "queue.binding.v1"
    }],
    [for key, resource in takoform_stateful_entity.entities : {
      name = {
        session               = "SESSION_DO"
        run_notifier          = "RUN_NOTIFIER"
        rate_limiter          = "RATE_LIMITER_DO"
        notification_notifier = "NOTIFICATION_NOTIFIER"
        routing               = "ROUTING_DO"
      }[key]
      resource    = resource.id
      permissions = ["invoke", "read", "write"]
      projection  = "stateful.binding.v1"
    }],
  )

  lifecycle {
    precondition {
      condition     = strcontains(local.artifact_url, format("/releases/download/%s/", trimspace(var.worker_release_tag)))
      error_message = "worker_artifact_url must select the exact worker_release_tag."
    }
  }
}

resource "takoform_schedule" "maintenance" {
  for_each = {
    quarter_hour = "3,18,33,48 * * * *"
    hourly       = "5 * * * *"
  }
  name     = format("%s-%s", local.prefix, replace(each.key, "_", "-"))
  cron     = each.value
  timezone = "UTC"

  connections = [{
    name        = "WORKER"
    resource    = takoform_edge_worker.app.id
    permissions = ["invoke"]
    projection  = "schedule.trigger.v1"
  }]
}

data "takoform_interface" "app_http" {
  name          = "http.request"
  version       = "1"
  resource_kind = "EdgeWorker"
  resource_name = takoform_edge_worker.app.name

  depends_on = [takoform_edge_worker.app]
}
