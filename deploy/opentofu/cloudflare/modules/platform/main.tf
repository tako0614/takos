terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.19.1"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.9.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "= 4.3.0"
    }
  }
}

locals {
  service_runtime_name = var.public_subdomain != null && trimspace(var.public_subdomain) != "" ? trimspace(var.public_subdomain) : var.project_name
  public_url_override  = var.public_url != null && trimspace(var.public_url) != "" ? trimsuffix(trimspace(var.public_url), "/") : null
  workers_dev_url      = var.workers_subdomain != null && trimspace(var.workers_subdomain) != "" ? "https://${local.service_runtime_name}.${trimspace(var.workers_subdomain)}.workers.dev" : null
  launch_url           = local.public_url_override != null ? local.public_url_override : local.workers_dev_url
  public_hostname      = local.launch_url == null ? null : try(regex("^https://([^/]+)", local.launch_url)[0], null)
  custom_route_enabled = var.zone_id != null && trimspace(var.zone_id) != "" && local.public_hostname != null && !can(regex("\\.workers\\.dev$", local.public_hostname))

  # These are the app-owned product resource names. The map is also hashed in
  # bridge triggers so a contract rename cannot silently reuse a staged result.
  product_resource_names = {
    app                      = "app"
    database                 = "database"
    hostname_routing         = "hostname-routing"
    worker_bundles           = "worker-bundles"
    tenant_builds            = "tenant-builds"
    tenant_source            = "tenant-source"
    git_objects              = "git-objects"
    offload                  = "offload"
    runs                     = "runs"
    runs_dlq                 = "runs-dlq"
    index_jobs               = "index-jobs"
    index_jobs_dlq           = "index-jobs-dlq"
    notification_push        = "notification-push"
    notification_push_dlq    = "notification-push-dlq"
    embeddings               = "embeddings"
    session                  = "session"
    run_notifier             = "run-notifier"
    notification_notifier    = "notification-notifier"
    rate_limiter             = "rate-limiter"
    routing                  = "routing"
    agent_tier_1             = "agent-tier-1"
    agent_tier_2             = "agent-tier-2"
    agent_tier_3             = "agent-tier-3"
    maintenance_quarter_hour = "maintenance-quarter-hour"
    maintenance_hourly       = "maintenance-hourly"
  }

  d1_databases = {
    db = "${var.project_name}-db"
  }

  r2_buckets = {
    worker_bundles = "${var.project_name}-worker-bundles"
    tenant_builds  = "${var.project_name}-tenant-builds"
    tenant_source  = "${var.project_name}-tenant-source"
    git_objects    = "${var.project_name}-git-objects"
    offload        = "${var.project_name}-offload"
  }

  queue_name_limit      = 62
  queue_name_hash_chars = 12
  queue_suffixes = {
    runs                  = "runs"
    index_jobs            = "index-jobs"
    notification_push     = "notification-push"
    runs_dlq              = "runs-dlq"
    index_jobs_dlq        = "index-jobs-dlq"
    notification_push_dlq = "notification-push-dlq"
  }
  queues = {
    for key, suffix in local.queue_suffixes : key => (
      length("${var.project_name}-${suffix}") <= local.queue_name_limit
      ? "${var.project_name}-${suffix}"
      : format(
        "%s-%s-%s",
        substr(
          var.project_name,
          0,
          local.queue_name_limit - length(suffix) - local.queue_name_hash_chars - 2,
        ),
        substr(sha256("${var.project_name}-${suffix}"), 0, local.queue_name_hash_chars),
        suffix,
      )
    )
  }

  kv_namespaces = {
    hostname_routing = "${var.project_name}-hostname-routing"
  }

  vectorize = {
    index_name = "${var.project_name}-embeddings"
    dimensions = 768
    metric     = "cosine"
  }

  # The release builder owns these files at the app module root. This child
  # module has a fixed `modules/platform` layout, so every file and provisioner
  # path stays relative to the restored module instead of capturing a runner
  # host path in state.
  app_module_root                    = "${path.module}/../.."
  app_module_working_dir             = local.app_module_root
  worker_module_path                 = var.plan_mode ? "fixtures/worker/index.js" : ".takos-build/worker/index.js"
  worker_module_file_path            = "${local.app_module_root}/${local.worker_module_path}"
  worker_assets_directory            = var.plan_mode ? "fixtures/assets" : ".takos-build/assets"
  worker_assets_directory_path       = "${local.app_module_root}/${local.worker_assets_directory}"
  migration_set_path                 = var.plan_mode ? "fixtures/migrations" : ".takos-build/migrations"
  migration_set_directory_path       = "${local.app_module_root}/${local.migration_set_path}"
  container_desired_config_path      = var.plan_mode ? "fixtures/container-desired.json" : ".takos-build/container-desired.json"
  container_desired_config_file_path = "${local.app_module_root}/${local.container_desired_config_path}"
  bridge_helper_path                 = var.plan_mode ? "fixtures/takos-cloudflare-opentofu-bridge.ts" : ".takos-build/bridge/takos-cloudflare-opentofu-bridge.ts"
  bridge_helper_file_path            = "${local.app_module_root}/${local.bridge_helper_path}"
  container_image                    = var.container_image
  container_image_is_registry        = can(regex("^registry\\.cloudflare\\.com/([0-9a-f]{32})/", var.container_image))
  container_image_registry_account   = local.container_image_is_registry ? regex("^registry\\.cloudflare\\.com/([0-9a-f]{32})/", var.container_image)[0] : ""
  container_image_shape_valid        = var.container_image != "" && can(regex("^(registry\\.cloudflare\\.com/[0-9a-f]{32}/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*|docker\\.io/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*)@sha256:[a-f0-9]{64}$", var.container_image))
  container_image_account_valid      = !local.container_image_is_registry || local.container_image_registry_account == var.account_id

  takosumi_accounts_issuer_url   = trimspace(var.takosumi_accounts_issuer_url)
  takosumi_accounts_client_id    = trimspace(var.takosumi_accounts_client_id)
  takosumi_accounts_url          = trimspace(var.takosumi_accounts_url) != "" ? trimspace(var.takosumi_accounts_url) : local.takosumi_accounts_issuer_url
  takosumi_accounts_redirect_uri = trimspace(var.takosumi_accounts_redirect_uri) != "" ? trimspace(var.takosumi_accounts_redirect_uri) : (local.launch_url != null ? "${local.launch_url}/auth/oidc/callback" : "")
  takosumi_accounts_oidc_enabled = local.takosumi_accounts_issuer_url != "" && local.takosumi_accounts_client_id != ""
  public_worker_env = local.launch_url != null ? {
    ADMIN_DOMAIN                     = local.public_hostname
    TENANT_BASE_DOMAIN               = local.public_hostname
    AUTH_PUBLIC_BASE_URL             = local.launch_url
    PROXY_BASE_URL                   = local.launch_url
    TAKOS_AGENT_CONTROL_RPC_BASE_URL = local.launch_url
  } : {}
  extra_worker_env = { for name, value in var.env : name => value if trimspace(value) != "" }
  worker_env = merge(
    local.extra_worker_env,
    local.public_worker_env,
    {
      CF_ACCOUNT_ID                      = var.account_id
      EXECUTOR_TIER1_WARM_POOL_SIZE      = tostring(var.executor_capacity.tier1_max_instances)
      EXECUTOR_TIER1_MAX_CONCURRENT_RUNS = tostring(var.executor_capacity.tier1_max_concurrent_runs)
      EXECUTOR_TIER3_POOL_SIZE           = tostring(var.executor_capacity.tier3_max_instances)
      EXECUTOR_TIER3_MAX_CONCURRENT_RUNS = tostring(var.executor_capacity.tier3_max_concurrent_runs)
    },
    var.zone_id != null && trimspace(var.zone_id) != "" ? { CF_ZONE_ID = trimspace(var.zone_id) } : {},
    local.takosumi_accounts_oidc_enabled && local.takosumi_accounts_url != "" ? {
      TAKOSUMI_ACCOUNTS_URL = local.takosumi_accounts_url
    } : {},
    local.takosumi_accounts_oidc_enabled ? {
      OIDC_ISSUER_URL = local.takosumi_accounts_issuer_url
      OIDC_CLIENT_ID  = local.takosumi_accounts_client_id
    } : {},
    local.takosumi_accounts_oidc_enabled && local.takosumi_accounts_redirect_uri != "" ? {
      OIDC_REDIRECT_URI = local.takosumi_accounts_redirect_uri
    } : {},
  )

  queue_consumers = {
    runs = {
      queue_key        = "runs"
      dlq_key          = "runs_dlq"
      batch_size       = 1
      max_wait_time_ms = 1000
      max_retries      = 5
      max_concurrency  = 5
      retry_delay      = 5
    }
    runs_dlq = {
      queue_key        = "runs_dlq"
      dlq_key          = null
      batch_size       = 10
      max_wait_time_ms = 60000
      max_retries      = 100
      max_concurrency  = 5
      retry_delay      = 5
    }
    index_jobs = {
      queue_key        = "index_jobs"
      dlq_key          = "index_jobs_dlq"
      batch_size       = 5
      max_wait_time_ms = 60000
      max_retries      = 2
      max_concurrency  = 5
      retry_delay      = 5
    }
    index_jobs_dlq = {
      queue_key        = "index_jobs_dlq"
      dlq_key          = null
      batch_size       = 10
      max_wait_time_ms = 60000
      max_retries      = 100
      max_concurrency  = 5
      retry_delay      = 5
    }
    notification_push = {
      queue_key        = "notification_push"
      dlq_key          = "notification_push_dlq"
      batch_size       = 5
      max_wait_time_ms = 5000
      max_retries      = 5
      max_concurrency  = 5
      retry_delay      = 5
    }
    notification_push_dlq = {
      queue_key        = "notification_push_dlq"
      dlq_key          = null
      batch_size       = 10
      max_wait_time_ms = 60000
      max_retries      = 100
      max_concurrency  = 5
      retry_delay      = 600
    }
  }

  schedules = {
    maintenance_quarter_hour = {
      name = "maintenance-quarter-hour"
      cron = "3,18,33,48 * * * *"
    }
    maintenance_hourly = {
      name = "maintenance-hourly"
      cron = "5 * * * *"
    }
  }

  runtime_secret_bindings = {
    ENCRYPTION_KEY            = random_password.encryption.result
    TAKOS_AGENT_START_TOKEN   = random_password.agent_start.result
    TAKOS_INTERNAL_API_SECRET = random_password.internal_api.result
    PLATFORM_PRIVATE_KEY      = tls_private_key.platform.private_key_pem
    PLATFORM_PUBLIC_KEY       = tls_private_key.platform.public_key_pem
  }
  secret_text_bindings = [
    for name, value in local.runtime_secret_bindings : {
      name = name
      type = "secret_text"
      text = value
    }
  ]
  plain_text_bindings = [
    for name, value in local.worker_env : {
      name = name
      type = "plain_text"
      text = value
    }
  ]

  # Evaluating file digests only when the bridge is opted in keeps ordinary
  # plan mode portable while making every imperative operation content-bound.
  worker_artifact_digest = var.enable_imperative_staging_bridge ? sha256(join("|", concat(
    ["worker/index.js:${filesha256(local.worker_module_file_path)}"],
    [for file in sort(tolist(fileset(local.worker_assets_directory_path, "**"))) : "assets/${file}:${filesha256("${local.worker_assets_directory_path}/${file}")}"]
  ))) : "bridge-disabled"
  migration_set_digest = var.enable_imperative_staging_bridge ? sha256(join("|", [
    for file in sort(tolist(fileset(local.migration_set_directory_path, "**/*.sql"))) : "${file}:${filesha256("${local.migration_set_directory_path}/${file}")}"
  ])) : "bridge-disabled"
  container_desired_config_digest = var.enable_imperative_staging_bridge ? filesha256(local.container_desired_config_file_path) : "bridge-disabled"
  bridge_helper_digest            = var.enable_imperative_staging_bridge ? filesha256(local.bridge_helper_file_path) : "bridge-disabled"
  vector_desired_config_digest    = sha256(jsonencode(local.vectorize))
  product_resource_digest         = sha256(jsonencode(local.product_resource_names))
  bridge_triggers = {
    helper                   = local.bridge_helper_digest
    worker_artifact          = local.worker_artifact_digest
    container_desired_config = local.container_desired_config_digest
    vector_desired_config    = local.vector_desired_config_digest
    migration_set            = local.migration_set_digest
    product_resources        = local.product_resource_digest
  }
  bridge_environment = {
    TAKOS_CLOUDFLARE_APP_MODULE_WORKING_DIR        = local.app_module_working_dir
    TAKOS_CLOUDFLARE_BRIDGE_HELPER_PATH            = local.bridge_helper_path
    TAKOS_CLOUDFLARE_ACCOUNT_ID                    = var.account_id
    TAKOS_CLOUDFLARE_WORKER_NAME                   = local.service_runtime_name
    TAKOS_CLOUDFLARE_D1_DATABASE_ID                = cloudflare_d1_database.this["db"].id
    TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME             = local.vectorize.index_name
    TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS       = tostring(local.vectorize.dimensions)
    TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC           = local.vectorize.metric
    TAKOS_CLOUDFLARE_MIGRATION_SET_PATH            = local.migration_set_path
    TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH = local.container_desired_config_path
    TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH          = local.worker_module_path
    TAKOS_CONTAINER_IMAGE                          = local.container_image
    TAKOS_EXECUTOR_TIER1_MAX_INSTANCES             = tostring(var.executor_capacity.tier1_max_instances)
    TAKOS_EXECUTOR_TIER2_MAX_INSTANCES             = tostring(var.executor_capacity.tier2_max_instances)
    TAKOS_EXECUTOR_TIER3_MAX_INSTANCES             = tostring(var.executor_capacity.tier3_max_instances)
  }
}

resource "random_password" "encryption" {
  length  = 64
  special = true
}

resource "random_password" "agent_start" {
  length  = 64
  special = true
}

resource "random_password" "internal_api" {
  length  = 64
  special = true
}

resource "tls_private_key" "platform" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "cloudflare_d1_database" "this" {
  for_each   = local.d1_databases
  account_id = var.account_id
  name       = each.value

  read_replication = {
    mode = "disabled"
  }
}

resource "cloudflare_workers_kv_namespace" "this" {
  for_each   = local.kv_namespaces
  account_id = var.account_id
  title      = each.value
}

resource "cloudflare_r2_bucket" "this" {
  for_each   = local.r2_buckets
  account_id = var.account_id
  name       = each.value
}

resource "cloudflare_queue" "this" {
  for_each   = local.queues
  account_id = var.account_id
  queue_name = each.value
}

resource "terraform_data" "provider_gap_pre" {
  count = var.enable_imperative_staging_bridge ? 1 : 0

  triggers_replace = local.bridge_triggers

  lifecycle {
    precondition {
      condition     = !var.enable_imperative_staging_bridge || (local.container_image_shape_valid && local.container_image_account_valid)
      error_message = "container_image must be a non-empty immutable Cloudflare-account or public Docker Hub digest when the staging bridge is enabled; a Cloudflare registry account must equal account_id."
    }
  }

  provisioner "local-exec" {
    working_dir = local.app_module_root
    command     = "bun ${local.bridge_helper_path} pre-worker"
    quiet       = true
    environment = local.bridge_environment
  }
}

resource "cloudflare_worker" "app" {
  account_id = var.account_id
  name       = local.service_runtime_name
  logpush    = false

  observability = {
    enabled            = true
    head_sampling_rate = 0.1
  }

  subdomain = {
    enabled          = true
    previews_enabled = false
  }
}

# Cloudflare applies Durable Object migrations only when a Worker Version is
# deployed, but rejects a Version that both creates a class and binds to it.
# Model Cloudflare's required two-step lifecycle explicitly: deploy one stable,
# non-serving migration Version without DO bindings, then upload/deploy the real
# application Version after those namespaces exist.
resource "cloudflare_worker_version" "durable_object_migrations" {
  account_id = var.account_id
  worker_id  = cloudflare_worker.app.id

  compatibility_date = "2026-04-01"
  main_module        = "durable-object-migration-bootstrap.js"

  modules = [{
    name         = "durable-object-migration-bootstrap.js"
    content_file = "${path.module}/durable-object-migration-bootstrap.js"
    content_type = "application/javascript+module"
  }]

  # Cloudflare creates a container-enabled Durable Object namespace only when
  # the same deployed Version declares both the SQLite migration and the
  # Container attachment metadata. This is metadata, not a namespace binding,
  # so it remains valid in the migration-only first deployment.
  containers = [
    { class_name = "ExecutorContainerTier1" },
    { class_name = "ExecutorContainerTier2" },
    { class_name = "ExecutorContainerTier3" },
  ]

  migrations = {
    new_tag = "v7"
    steps = [
      { new_classes = ["SessionDO"] },
      { new_classes = ["RunNotifierDO"] },
      { new_classes = ["RateLimiterDO"] },
      { new_classes = ["NotificationNotifierDO"] },
      { new_classes = ["RoutingDO"] },
      { new_sqlite_classes = ["TakosRuntimeContainer", "ExecutorContainerTier1", "ExecutorContainerTier2", "ExecutorContainerTier3"] },
      { deleted_classes = ["TakosRuntimeContainer"] },
    ]
  }

  depends_on = [terraform_data.provider_gap_pre]
}

resource "cloudflare_workers_deployment" "durable_object_migrations" {
  account_id  = var.account_id
  script_name = cloudflare_worker.app.name
  strategy    = "percentage"

  versions = [{
    percentage = 100
    version_id = cloudflare_worker_version.durable_object_migrations.id
  }]
}

resource "cloudflare_worker_version" "app" {
  account_id = var.account_id
  worker_id  = cloudflare_worker.app.id

  compatibility_date = "2026-04-01"
  compatibility_flags = [
    "nodejs_compat",
    "no_handle_cross_request_promise_resolution",
    "global_fetch_strictly_public",
  ]
  main_module = "index.js"

  modules = [{
    name         = "index.js"
    content_file = local.worker_module_file_path
    content_type = "application/javascript+module"
  }]

  assets = {
    directory = local.worker_assets_directory_path
    config = {
      run_worker_first = true
    }
  }

  bindings = concat(
    [
      { name = "ASSETS", type = "assets" },
      { name = "DB", type = "d1", id = cloudflare_d1_database.this["db"].id },
      { name = "HOSTNAME_ROUTING", type = "kv_namespace", namespace_id = cloudflare_workers_kv_namespace.this["hostname_routing"].id },
      { name = "WORKER_BUNDLES", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.this["worker_bundles"].name },
      { name = "TENANT_BUILDS", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.this["tenant_builds"].name },
      { name = "TENANT_SOURCE", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.this["tenant_source"].name },
      { name = "GIT_OBJECTS", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.this["git_objects"].name },
      { name = "TAKOS_OFFLOAD", type = "r2_bucket", bucket_name = cloudflare_r2_bucket.this["offload"].name },
      { name = "RUN_QUEUE", type = "queue", queue_name = cloudflare_queue.this["runs"].queue_name },
      { name = "INDEX_QUEUE", type = "queue", queue_name = cloudflare_queue.this["index_jobs"].queue_name },
      { name = "TAKOS_NOTIFICATION_PUSH_QUEUE", type = "queue", queue_name = cloudflare_queue.this["notification_push"].queue_name },
      { name = "VECTORIZE", type = "vectorize", index_name = local.vectorize.index_name },
      { name = "AI", type = "ai" },
      { name = "SESSION_DO", type = "durable_object_namespace", class_name = "SessionDO" },
      { name = "RUN_NOTIFIER", type = "durable_object_namespace", class_name = "RunNotifierDO" },
      { name = "NOTIFICATION_NOTIFIER", type = "durable_object_namespace", class_name = "NotificationNotifierDO" },
      { name = "RATE_LIMITER_DO", type = "durable_object_namespace", class_name = "RateLimiterDO" },
      { name = "ROUTING_DO", type = "durable_object_namespace", class_name = "RoutingDO" },
      { name = "EXECUTOR_CONTAINER", type = "durable_object_namespace", class_name = "ExecutorContainerTier1" },
      { name = "EXECUTOR_CONTAINER_TIER2", type = "durable_object_namespace", class_name = "ExecutorContainerTier2" },
      { name = "EXECUTOR_CONTAINER_TIER3", type = "durable_object_namespace", class_name = "ExecutorContainerTier3" },
      { name = "TAKOS_EGRESS", type = "service", service = local.service_runtime_name, entrypoint = "TakosEgressEntrypoint" },
    ],
    local.secret_text_bindings,
    local.plain_text_bindings,
  )

  containers = [
    { class_name = "ExecutorContainerTier1" },
    { class_name = "ExecutorContainerTier2" },
    { class_name = "ExecutorContainerTier3" },
  ]

  depends_on = [cloudflare_workers_deployment.durable_object_migrations]
}

resource "cloudflare_workers_deployment" "app" {
  account_id  = var.account_id
  script_name = cloudflare_worker.app.name
  strategy    = "percentage"

  versions = [{
    percentage = 100
    version_id = cloudflare_worker_version.app.id
  }]
}

resource "cloudflare_queue_consumer" "this" {
  for_each    = local.queue_consumers
  account_id  = var.account_id
  queue_id    = cloudflare_queue.this[each.value.queue_key].id
  script_name = cloudflare_worker.app.name
  type        = "worker"

  dead_letter_queue = each.value.dlq_key == null ? null : local.queues[each.value.dlq_key]
  settings = {
    batch_size       = each.value.batch_size
    max_wait_time_ms = each.value.max_wait_time_ms
    max_retries      = each.value.max_retries
    max_concurrency  = each.value.max_concurrency
    retry_delay      = each.value.retry_delay
  }

  depends_on = [cloudflare_workers_deployment.app]
}

resource "cloudflare_workers_cron_trigger" "this" {
  for_each = {
    "maintenance-quarter-hour" = local.schedules.maintenance_quarter_hour
    "maintenance-hourly"       = local.schedules.maintenance_hourly
  }
  account_id  = var.account_id
  script_name = cloudflare_worker.app.name
  schedules = [{
    cron = each.value.cron
  }]

  depends_on = [cloudflare_workers_deployment.app]
}

resource "cloudflare_workers_route" "public" {
  count   = local.custom_route_enabled ? 1 : 0
  zone_id = var.zone_id
  pattern = "${local.public_hostname}/*"
  script  = cloudflare_worker.app.name

  depends_on = [cloudflare_workers_deployment.app]
}

resource "terraform_data" "provider_gap_post" {
  count = var.enable_imperative_staging_bridge ? 1 : 0

  input            = local.bridge_environment
  triggers_replace = local.bridge_triggers
  depends_on       = [cloudflare_workers_deployment.app]

  provisioner "local-exec" {
    working_dir = local.app_module_root
    command     = "bun ${local.bridge_helper_path} post-worker"
    quiet       = true
    environment = local.bridge_environment
  }

  # The helper only removes provider-gap objects that can be proven to belong
  # to this worker. It does not pretend to roll back D1 data or cron state.
  provisioner "local-exec" {
    when        = destroy
    working_dir = self.input.TAKOS_CLOUDFLARE_APP_MODULE_WORKING_DIR
    command     = "bun ${self.input.TAKOS_CLOUDFLARE_BRIDGE_HELPER_PATH} recovery-cleanup"
    quiet       = true
    environment = self.input
  }
}
