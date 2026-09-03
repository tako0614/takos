terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 5.19.1"
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

  # This is the single lifecycle description consumed by both the ordinary
  # provider path and the app-owned Cloudflare provider-gap bridge. Keeping
  # the tags beside their steps lets the bridge resume from an existing tag
  # without replaying an already-applied migration.
  durable_object_lifecycle = {
    tags = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"]
    steps = [
      { new_classes = ["SessionDO"] },
      { new_classes = ["RunNotifierDO"] },
      { new_classes = ["RateLimiterDO"] },
      { new_classes = ["NotificationNotifierDO"] },
      { new_classes = ["RoutingDO"] },
      { new_sqlite_classes = ["TakosRuntimeContainer", "ExecutorContainerTier1", "ExecutorContainerTier2", "ExecutorContainerTier3"] },
      { deleted_classes = ["TakosRuntimeContainer"] },
    ]
    container_bindings = [
      { name = "EXECUTOR_CONTAINER", class_name = "ExecutorContainerTier1" },
      { name = "EXECUTOR_CONTAINER_TIER2", class_name = "ExecutorContainerTier2" },
      { name = "EXECUTOR_CONTAINER_TIER3", class_name = "ExecutorContainerTier3" },
    ]
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
  container_desired_config_path      = var.plan_mode ? "fixtures/container-desired.json" : ".takos-build/container-desired.json"
  container_desired_config_file_path = "${local.app_module_root}/${local.container_desired_config_path}"
  bridge_helper_path                 = var.plan_mode ? "fixtures/takos-cloudflare-opentofu-bridge.ts" : ".takos-build/bridge/takos-cloudflare-opentofu-bridge.ts"
  bridge_helper_file_path            = "${local.app_module_root}/${local.bridge_helper_path}"
  durable_object_bootstrap_path      = "modules/platform/durable-object-migration-bootstrap.js"
  durable_object_bootstrap_file_path = "${local.app_module_root}/${local.durable_object_bootstrap_path}"
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

  # queue_consumers is generated into queue-consumers.generated.tf from
  # scripts/queue-consumer-contract.ts, which the Worker's own queue policy
  # modules feed. wrangler.toml's consumer blocks come from the same contract.

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

  # The exact `env.<NAME>` runtime secrets the Takos Worker reads. This module
  # names them and never holds a value: an OpenTofu-minted secret would persist
  # in the state a Takosumi Run keeps as a StateVersion, which
  # deploy/TAKOSUMI_DEPLOY.md forbids. The request for host-minted values is
  # declared in .well-known/takosumi.json as `secret.generated` bindings; the
  # RSA pair is operator-supplied because no generated-secret shape expresses it.
  runtime_secret_binding_names = [
    "ENCRYPTION_KEY",
    "TAKOS_AGENT_START_TOKEN",
    "TAKOS_INTERNAL_API_SECRET",
    "PLATFORM_PRIVATE_KEY",
    "PLATFORM_PUBLIC_KEY",
  ]
  # `inherit` carries a binding forward from the Worker's previous version
  # without sending its value, so a later apply cannot silently drop a secret
  # that was supplied out of band. A Worker Version's binding list is complete,
  # so omitting these five names does not leave them alone: it publishes a
  # version without ENCRYPTION_KEY, and every AES-256-GCM payload written under
  # it — MCP OAuth tokens, registry credentials, environment snapshots —
  # becomes unreadable. That is why the names are bound by default and why
  # dropping them takes a deliberate acknowledgement rather than one boolean.
  #
  # The one apply that legitimately cannot inherit is the very first, before
  # any value exists. It is declared, not defaulted.
  runtime_secret_binding_targets = var.runtime_secrets_provisioned ? local.runtime_secret_binding_names : []
  runtime_secret_bindings = [
    for name in local.runtime_secret_binding_targets : {
      name = name
      type = "inherit"
    }
  ]
  plain_text_bindings = [
    for name, value in local.worker_env : {
      name = name
      type = "plain_text"
      text = value
    }
  ]

  provider_gap_bridge_enabled = var.cloudflare_provider_gap_bridge_mode != "off"

  # A `VECTORIZE` binding is only honest when something actually created the
  # index. The Cloudflare provider has no Vectorize resource, so on the
  # ordinary provider path the index can only come from outside this module;
  # the bridge lanes create it themselves. Binding it unconditionally is what
  # made `resolveRuntimeCapabilities` answer `vectorSearch: vectorize` on a
  # deployment whose every vector call fails, instead of the declared
  # `vectorSearch: disabled` degraded mode.
  vector_index_available = local.provider_gap_bridge_enabled || var.vector_index_provisioned
  vector_bindings = local.vector_index_available ? [
    { name = "VECTORIZE", type = "vectorize", index_name = local.vectorize.index_name },
  ] : []
  bridge_acknowledgement_digest = sha256(var.cloudflare_provider_gap_bridge_acknowledgement)

  # Evaluating file digests only when the bridge is opted in keeps ordinary
  # plan mode portable while making every imperative operation content-bound.
  worker_artifact_digest = local.provider_gap_bridge_enabled ? sha256(join("|", concat(
    ["worker/index.js:${filesha256(local.worker_module_file_path)}"],
    [for file in sort(tolist(fileset(local.worker_assets_directory_path, "**"))) : "assets/${file}:${filesha256("${local.worker_assets_directory_path}/${file}")}"]
  ))) : "bridge-disabled"
  container_desired_config_digest = local.provider_gap_bridge_enabled ? filesha256(local.container_desired_config_file_path) : "bridge-disabled"
  container_rendered_input_digest = local.provider_gap_bridge_enabled ? sha256(jsonencode({
    template_digest = local.container_desired_config_digest
    worker_name     = local.service_runtime_name
    image           = local.container_image
    executor_capacity = {
      tier1_max_instances = var.executor_capacity.tier1_max_instances
      tier2_max_instances = var.executor_capacity.tier2_max_instances
      tier3_max_instances = var.executor_capacity.tier3_max_instances
    }
  })) : "bridge-disabled"
  bridge_helper_digest            = local.provider_gap_bridge_enabled ? filesha256(local.bridge_helper_file_path) : "bridge-disabled"
  durable_object_bootstrap_digest = local.provider_gap_bridge_enabled ? filesha256(local.durable_object_bootstrap_file_path) : "bridge-disabled"
  durable_object_migration_digest = local.provider_gap_bridge_enabled ? sha256(jsonencode(local.durable_object_lifecycle)) : "bridge-disabled"
  vector_desired_config_digest    = sha256(jsonencode(local.vectorize))
  product_resource_digest         = sha256(jsonencode(local.product_resource_names))
  bridge_triggers = {
    account_id               = var.account_id
    provider_gap_bridge_mode = var.cloudflare_provider_gap_bridge_mode
    bridge_acknowledgement   = local.bridge_acknowledgement_digest
    helper                   = local.bridge_helper_digest
    durable_object_bootstrap = local.durable_object_bootstrap_digest
    durable_object_lifecycle = local.durable_object_migration_digest
    worker_artifact          = local.worker_artifact_digest
    container_desired_config = local.container_desired_config_digest
    container_rendered_input = local.container_rendered_input_digest
    vector_desired_config    = local.vector_desired_config_digest
    product_resources        = local.product_resource_digest
  }
  # The capability preflight intentionally carries only activation metadata
  # and the account identifier.  The API token remains inherited by
  # local-exec from the operator process and is never placed in Terraform
  # input, triggers, or state.
  bridge_capability_environment = {
    TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE            = var.cloudflare_provider_gap_bridge_mode
    TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT = var.cloudflare_provider_gap_bridge_acknowledgement
    TAKOS_CLOUDFLARE_ENVIRONMENT                         = var.environment
    TAKOS_CLOUDFLARE_ACCOUNT_ID                          = var.account_id
  }
  bridge_environment = merge(
    {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE            = var.cloudflare_provider_gap_bridge_mode
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT = var.cloudflare_provider_gap_bridge_acknowledgement
      TAKOS_CLOUDFLARE_ENVIRONMENT                         = var.environment
      TAKOS_CLOUDFLARE_APP_MODULE_WORKING_DIR              = local.app_module_working_dir
      TAKOS_CLOUDFLARE_BRIDGE_HELPER_PATH                  = local.bridge_helper_path
      TAKOS_CLOUDFLARE_ACCOUNT_ID                          = var.account_id
      TAKOS_CLOUDFLARE_WORKER_NAME                         = local.service_runtime_name
      TAKOS_CLOUDFLARE_VECTOR_INDEX_NAME                   = local.vectorize.index_name
      TAKOS_CLOUDFLARE_VECTOR_INDEX_DIMENSIONS             = tostring(local.vectorize.dimensions)
      TAKOS_CLOUDFLARE_VECTOR_INDEX_METRIC                 = local.vectorize.metric
      TAKOS_CLOUDFLARE_WORKER_ASSETS_PATH                  = local.worker_assets_directory
      TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_PATH       = local.container_desired_config_path
      TAKOS_CLOUDFLARE_WORKER_ARTIFACT_PATH                = local.worker_module_path
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_BOOTSTRAP_PATH       = local.durable_object_bootstrap_path
      TAKOS_CLOUDFLARE_DURABLE_OBJECT_LIFECYCLE            = jsonencode(local.durable_object_lifecycle)
      TAKOS_CONTAINER_IMAGE                                = local.container_image
      TAKOS_EXECUTOR_TIER1_MAX_INSTANCES                   = tostring(var.executor_capacity.tier1_max_instances)
      TAKOS_EXECUTOR_TIER2_MAX_INSTANCES                   = tostring(var.executor_capacity.tier2_max_instances)
      TAKOS_EXECUTOR_TIER3_MAX_INSTANCES                   = tostring(var.executor_capacity.tier3_max_instances)
    },
    local.provider_gap_bridge_enabled ? {
      # Keep the rendered template content in state so a trigger replacement
      # destroys the old ownership projection instead of rereading a mutable
      # path that now contains the next build. This branch remains lazy while
      # the bridge is off, so ordinary plans do not need source-build output.
      TAKOS_CLOUDFLARE_CONTAINER_DESIRED_CONFIG_CONTENT = file(local.container_desired_config_file_path)
    } : {},
  )
}

resource "cloudflare_d1_database" "this" {
  for_each   = local.d1_databases
  account_id = var.account_id
  name       = each.value

  read_replication = {
    mode = "disabled"
  }

  depends_on = [terraform_data.provider_gap_capability]
}

resource "cloudflare_workers_kv_namespace" "this" {
  for_each   = local.kv_namespaces
  account_id = var.account_id
  title      = each.value

  depends_on = [terraform_data.provider_gap_capability]
}

resource "cloudflare_r2_bucket" "this" {
  for_each   = local.r2_buckets
  account_id = var.account_id
  name       = each.value

  depends_on = [terraform_data.provider_gap_capability]
}

resource "cloudflare_queue" "this" {
  for_each   = local.queues
  account_id = var.account_id
  queue_name = each.value

  depends_on = [terraform_data.provider_gap_capability]
}

# The bridge modes gate exactly three imperative Cloudflare operations the
# provider cannot express: Vectorize index creation, the container-enabled
# Durable Object bootstrap upload, and Container application reconciliation.
# D1 schema is no longer part of that set; the Worker applies its embedded
# migration set at runtime, so no Apply-time step mutates durable data.
resource "terraform_data" "provider_gap_contract" {
  input = {
    mode                   = var.cloudflare_provider_gap_bridge_mode
    acknowledgement_digest = local.bridge_acknowledgement_digest
    environment            = var.environment
  }

  lifecycle {
    precondition {
      condition     = var.cloudflare_provider_gap_bridge_mode != "staging" || var.environment == "staging"
      error_message = "staging Cloudflare provider-gap bridge mode requires environment to be exactly staging."
    }

    precondition {
      condition     = var.cloudflare_provider_gap_bridge_mode != "disposable-production" || var.environment == "production"
      error_message = "disposable-production Cloudflare provider-gap bridge mode requires environment to be exactly production."
    }

    precondition {
      condition     = var.cloudflare_provider_gap_bridge_mode != "disposable-production" || var.cloudflare_provider_gap_bridge_acknowledgement == "DISPOSABLE_PRODUCTION_ONE_SHOT"
      error_message = "disposable-production Cloudflare provider-gap bridge mode requires the exact DISPOSABLE_PRODUCTION_ONE_SHOT acknowledgement."
    }

    precondition {
      condition     = var.cloudflare_provider_gap_bridge_mode == "disposable-production" || var.cloudflare_provider_gap_bridge_acknowledgement == ""
      error_message = "cloudflare_provider_gap_bridge_acknowledgement must be empty unless disposable-production bridge mode is selected."
    }

    precondition {
      condition     = !var.vector_index_provisioned || !local.provider_gap_bridge_enabled
      error_message = "vector_index_provisioned declares an externally created Vectorize index; the provider-gap bridge creates and owns the index itself, so exactly one of them may claim it."
    }

    # A Worker Version's binding list is complete, so an apply with
    # runtime_secrets_provisioned = false publishes a version without
    # ENCRYPTION_KEY and leaves every payload encrypted under it unreadable.
    # The one apply that legitimately cannot inherit is the first, before any
    # value exists, and it has to say so.
    precondition {
      condition     = var.runtime_secrets_provisioned || var.first_install_acknowledgement == "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"
      error_message = "runtime_secrets_provisioned = false drops every runtime secret binding from the next Worker Version, including ENCRYPTION_KEY. Only a first install may do that, and it must set first_install_acknowledgement = \"FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS\"."
    }

    precondition {
      condition     = !var.runtime_secrets_provisioned || var.first_install_acknowledgement == ""
      error_message = "first_install_acknowledgement must be empty once runtime_secrets_provisioned is true; leaving it set would carry a first-install waiver into ordinary applies."
    }
  }
}

resource "terraform_data" "provider_gap_capability" {
  count = local.provider_gap_bridge_enabled ? 1 : 0

  input = local.bridge_capability_environment
  triggers_replace = {
    account_id               = var.account_id
    provider_gap_bridge_mode = var.cloudflare_provider_gap_bridge_mode
    bridge_acknowledgement   = local.bridge_acknowledgement_digest
    environment              = var.environment
  }
  depends_on = [terraform_data.provider_gap_contract]

  # This is a read-only account capability probe. The API token is inherited
  # from the operator process by local-exec and is deliberately absent from
  # the Terraform environment map/state.
  provisioner "local-exec" {
    working_dir = local.app_module_root
    command     = "bun ${local.bridge_helper_path} capability-preflight"
    quiet       = true
    environment = local.bridge_capability_environment
  }
}

resource "terraform_data" "provider_gap_cleanup" {
  count = local.provider_gap_bridge_enabled ? 1 : 0

  input            = local.bridge_environment
  triggers_replace = local.bridge_triggers
  # This anchor is intentionally created before either imperative phase. It
  # has no create provisioner, so a tainted pre/post phase cannot suppress its
  # destroy-time cleanup. Keeping the Worker identity as an upstream
  # dependency also leaves the namespace/binding authority available while
  # recovery-cleanup performs its ownership readback.
  depends_on = [cloudflare_worker.app]

  provisioner "local-exec" {
    when        = destroy
    working_dir = self.input.TAKOS_CLOUDFLARE_APP_MODULE_WORKING_DIR
    command     = "bun ${self.input.TAKOS_CLOUDFLARE_BRIDGE_HELPER_PATH} recovery-cleanup"
    quiet       = true
    environment = merge(self.input, {
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE            = lookup(self.input, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE", "staging")
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT = lookup(self.input, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT", "")
      TAKOS_CLOUDFLARE_ENVIRONMENT                         = lookup(self.input, "TAKOS_CLOUDFLARE_ENVIRONMENT", "staging")
      TAKOS_CLOUDFLARE_RECOVERY_STATE_PATH                 = "../terraform.tfstate"
    })
  }
}

resource "terraform_data" "provider_gap_pre" {
  count = local.provider_gap_bridge_enabled ? 1 : 0

  triggers_replace = local.bridge_triggers
  depends_on       = [cloudflare_worker.app, terraform_data.provider_gap_capability, terraform_data.provider_gap_contract, terraform_data.provider_gap_cleanup]

  lifecycle {
    precondition {
      condition     = local.container_image_shape_valid && local.container_image_account_valid
      error_message = "container_image must be a non-empty immutable Cloudflare-account or public Docker Hub digest when the Cloudflare provider-gap bridge is enabled; a Cloudflare registry account must equal account_id."
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

  # Worker versions bind these resources, but that creates only a sibling
  # dependency: after the version/deployment is removed, OpenTofu could still
  # destroy the Worker identity and its backing resources concurrently. Keep
  # every bound resource alive until the Worker is gone; destroy reverses these
  # create-time edges and therefore deletes the Worker first.
  depends_on = [
    terraform_data.provider_gap_capability,
    cloudflare_d1_database.this,
    cloudflare_workers_kv_namespace.this,
    cloudflare_r2_bucket.this,
    cloudflare_queue.this,
  ]
}

# The ordinary provider path models migration and binding as two Versions
# because Cloudflare rejects a Version that both creates a class and binds it.
# The provider-gap bridge skips this resource: the Workers Versions endpoint
# accepts Container metadata but does not currently make the namespace
# container-ready, so pre-worker performs the same migration through the
# legacy script endpoint.
resource "cloudflare_worker_version" "durable_object_migrations" {
  count = local.provider_gap_bridge_enabled ? 0 : 1

  account_id = var.account_id
  worker_id  = cloudflare_worker.app.id

  compatibility_date = "2026-04-01"
  main_module        = "durable-object-migration-bootstrap.js"

  modules = [{
    name         = "durable-object-migration-bootstrap.js"
    content_file = "${path.module}/durable-object-migration-bootstrap.js"
    content_type = "application/javascript+module"
  }]

  # Keep the Container attachment metadata beside the SQLite migration for the
  # ordinary provider lane. It is metadata, not a namespace binding, so the
  # migration-only Version remains non-serving.
  containers = [for binding in local.durable_object_lifecycle.container_bindings : {
    class_name = binding.class_name
  }]

  migrations = {
    new_tag = local.durable_object_lifecycle.tags[length(local.durable_object_lifecycle.tags) - 1]
    steps   = local.durable_object_lifecycle.steps
  }

  depends_on = [terraform_data.provider_gap_capability, terraform_data.provider_gap_pre]
}

resource "cloudflare_workers_deployment" "durable_object_migrations" {
  count = local.provider_gap_bridge_enabled ? 0 : 1

  account_id  = var.account_id
  script_name = cloudflare_worker.app.name
  strategy    = "percentage"

  versions = [{
    percentage = 100
    version_id = cloudflare_worker_version.durable_object_migrations[0].id
  }]

  depends_on = [terraform_data.provider_gap_capability]
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
      { name = "AI", type = "ai" },
      { name = "SESSION_DO", type = "durable_object_namespace", class_name = "SessionDO" },
      { name = "RUN_NOTIFIER", type = "durable_object_namespace", class_name = "RunNotifierDO" },
      { name = "NOTIFICATION_NOTIFIER", type = "durable_object_namespace", class_name = "NotificationNotifierDO" },
      { name = "RATE_LIMITER_DO", type = "durable_object_namespace", class_name = "RateLimiterDO" },
      { name = "ROUTING_DO", type = "durable_object_namespace", class_name = "RoutingDO" },
      { name = "TAKOS_EGRESS", type = "service", service = local.service_runtime_name, entrypoint = "TakosEgressEntrypoint" },
    ],
    local.vector_bindings,
    [for binding in local.durable_object_lifecycle.container_bindings : {
      name       = binding.name
      type       = "durable_object_namespace"
      class_name = binding.class_name
    }],
    local.runtime_secret_bindings,
    local.plain_text_bindings,
  )

  containers = [for binding in local.durable_object_lifecycle.container_bindings : {
    class_name = binding.class_name
  }]

  depends_on = [
    terraform_data.provider_gap_capability,
    cloudflare_workers_deployment.durable_object_migrations,
    terraform_data.provider_gap_pre,
  ]
}

resource "cloudflare_workers_deployment" "app" {
  account_id  = var.account_id
  script_name = cloudflare_worker.app.name
  strategy    = "percentage"

  versions = [{
    percentage = 100
    version_id = cloudflare_worker_version.app.id
  }]

  depends_on = [terraform_data.provider_gap_capability]
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

  depends_on = [terraform_data.provider_gap_capability, cloudflare_workers_deployment.app]
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

  depends_on = [terraform_data.provider_gap_capability, cloudflare_workers_deployment.app]
}

resource "cloudflare_workers_route" "public" {
  count   = local.custom_route_enabled ? 1 : 0
  zone_id = var.zone_id
  pattern = "${local.public_hostname}/*"
  script  = cloudflare_worker.app.name

  depends_on = [terraform_data.provider_gap_capability, cloudflare_workers_deployment.app]
}

resource "terraform_data" "provider_gap_post" {
  count = local.provider_gap_bridge_enabled ? 1 : 0

  input            = local.bridge_environment
  triggers_replace = local.bridge_triggers
  depends_on       = [cloudflare_workers_deployment.app, terraform_data.provider_gap_cleanup]

  provisioner "local-exec" {
    working_dir = local.app_module_root
    command     = "bun ${local.bridge_helper_path} post-worker"
    quiet       = true
    environment = local.bridge_environment
  }

  # The helper only removes provider-gap objects that can be proven to belong
  # to this worker. It never reads or rolls back D1 data or cron state.
  provisioner "local-exec" {
    when        = destroy
    working_dir = self.input.TAKOS_CLOUDFLARE_APP_MODULE_WORKING_DIR
    command     = "bun ${self.input.TAKOS_CLOUDFLARE_BRIDGE_HELPER_PATH} recovery-cleanup"
    quiet       = true
    environment = merge(self.input, {
      # The pre-rename bridge was staging-only, so state written before the
      # mode/ack inputs existed must remain runnable during destroy.
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE            = lookup(self.input, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_MODE", "staging")
      TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT = lookup(self.input, "TAKOS_CLOUDFLARE_PROVIDER_GAP_BRIDGE_ACKNOWLEDGEMENT", "")
      TAKOS_CLOUDFLARE_ENVIRONMENT                         = lookup(self.input, "TAKOS_CLOUDFLARE_ENVIRONMENT", "staging")
      TAKOS_CLOUDFLARE_RECOVERY_STATE_PATH                 = "../terraform.tfstate"
    })
  }
}
