terraform {
  required_version = ">= 1.5"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Cloudflare backing resources for the Takos product worker.
#
# Topology: one Takos Worker installed and managed by an external Takosumi
# control plane as a normal OpenTofu Capsule. Takos owns its product runtime
# resources here; Takosumi Accounts, Run ledger, and OpenTofu runner resources
# belong to the Takosumi control plane, not this module.
#
# Module contract: this module owns the durable backing infrastructure the
# worker needs (D1, KV, R2, Queues) — the equivalent of the AWS RDS/SQS/S3 and
# GCP CloudSQL/PubSub/GCS modules. `tofu apply` of this module provisions those
# resources and exports the binding map consumed by the worker artifact upload.
#
# Current Takos still performs one app-owned follow-up deploy step because the
# full distribution artifact includes container images, Durable Object
# migrations, and a Vectorize index; the Cloudflare provider does not expose a
# Vectorize index resource. As provider coverage improves, Worker script/assets,
# queue consumers, routes, and other expressible resources should move into
# OpenTofu rather than remaining hidden behind the follow-up command.
#
# Running this module through Takosumi adds the Workspace / Project / Capsule /
# Run / StateVersion / Output ledger, policy decisions, audit trail, and
# dashboard. Takos has no architectural privilege there: it is one plain
# OpenTofu module app.

locals {
  name        = var.project_name
  worker_name = var.worker_name != null && trimspace(var.worker_name) != "" ? trimspace(var.worker_name) : var.project_name
  app_url     = var.app_url != null && trimspace(var.app_url) != "" ? trimspace(var.app_url) : null

  takosumi_accounts_issuer_url   = trimspace(var.takosumi_accounts_issuer_url)
  takosumi_accounts_client_id    = trimspace(var.takosumi_accounts_client_id)
  takosumi_accounts_url          = trimspace(var.takosumi_accounts_url) != "" ? trimspace(var.takosumi_accounts_url) : local.takosumi_accounts_issuer_url
  takosumi_accounts_redirect_uri = trimspace(var.takosumi_accounts_redirect_uri) != "" ? trimspace(var.takosumi_accounts_redirect_uri) : (local.app_url != null ? "${local.app_url}/auth/oidc/callback" : "")
  takosumi_accounts_oidc_enabled = local.takosumi_accounts_issuer_url != "" && local.takosumi_accounts_client_id != ""
  extra_worker_env               = { for name, value in var.env : name => value if trimspace(value) != "" }
  app_deployment_env = merge(
    local.extra_worker_env,
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

  # D1 databases keyed by logical binding:
  #   db — binding DB (Takos product control-plane relational tables)
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

  # Queue NAMES are free-form; the worker reaches them by BINDING name, so the
  # names are parameterized under project_name. Logical key -> binding:
  #   runs            RUN_QUEUE          | runs_dlq            (DLQ for runs)
  #   index_jobs      INDEX_QUEUE        | index_jobs_dlq      (DLQ)
  #   workflow        WORKFLOW_QUEUE     | workflow_dlq        (DLQ)
  #   deployment      DEPLOY_QUEUE       | deployment_dlq      (DLQ)
  #
  queues = {
    runs           = "${var.project_name}-runs"
    index_jobs     = "${var.project_name}-index-jobs"
    workflow       = "${var.project_name}-workflow-jobs"
    deployment     = "${var.project_name}-deployment-jobs"
    runs_dlq       = "${var.project_name}-runs-dlq"
    index_jobs_dlq = "${var.project_name}-index-jobs-dlq"
    workflow_dlq   = "${var.project_name}-workflow-jobs-dlq"
    deployment_dlq = "${var.project_name}-deployment-jobs-dlq"
  }

  kv_namespaces = {
    hostname_routing = "${var.project_name}-hostname-routing"
    rollout_health   = "${var.project_name}-rollout-health"
  }

  vectorize = {
    index_name = "${var.project_name}-embeddings"
    dimensions = 768
    metric     = "cosine"
  }
}

# D1 databases — binding DB
resource "cloudflare_d1_database" "this" {
  for_each   = local.d1_databases
  account_id = var.account_id
  name       = each.value

  read_replication = {
    mode = "disabled"
  }
}

# KV namespaces — bindings HOSTNAME_ROUTING, ROLLOUT_HEALTH_KV
resource "cloudflare_workers_kv_namespace" "this" {
  for_each   = local.kv_namespaces
  account_id = var.account_id
  title      = each.value
}

# R2 buckets — bindings WORKER_BUNDLES, TENANT_BUILDS, TENANT_SOURCE,
# GIT_OBJECTS, TAKOS_OFFLOAD
resource "cloudflare_r2_bucket" "this" {
  for_each   = local.r2_buckets
  account_id = var.account_id
  name       = each.value
}

# Queues — bindings RUN_QUEUE, INDEX_QUEUE, WORKFLOW_QUEUE, DEPLOY_QUEUE,
# plus the four dead-letter queues
# referenced by the run/index/workflow/deployment consumers in wrangler.toml.
resource "cloudflare_queue" "this" {
  for_each   = local.queues
  account_id = var.account_id
  queue_name = each.value
}

# Vectorize index — binding VECTORIZE.
# The cloudflare/cloudflare v5 provider does not currently expose a Vectorize
# index resource. Until it does, the reviewed app-owned release activation
# bridge creates this provider-gap resource with wrangler before uploading the
# Worker artifact. The expected name is still exported from this OpenTofu module
# so the binding map, output ledger, and destroy bridge stay deterministic.
