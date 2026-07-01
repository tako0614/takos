terraform {
  required_version = ">= 1.5"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Cloudflare backing resources for the self-hosted Takos product worker.
#
# Topology: ONE unified Worker (Takos product + the embedded accounts plane as
# its own bare-origin OIDC issuer + the in-process Takosumi deploy-control
# plane) — not the retired "four Worker scripts" world. The binding map mirrored
# here is takos/deploy/cloudflare/wrangler.toml (the self-host template); keep
# the two in sync.
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
# Takosumi is OPTIONAL: running this same module through Takosumi adds the
# Workspace / Project / Capsule / Run / StateVersion / Output ledger, policy decisions, audit
# trail, and dashboard, and records the IDs below as Output. Takos has
# no architectural privilege there — it is one plain OpenTofu module app.

locals {
  name        = var.project_name
  worker_name = var.project_name

  # D1 databases keyed by logical binding. Three separate databases live in the
  # one worker because their schemas are namespace-incompatible:
  #   db       — binding DB (product control-plane relational tables)
  #   accounts — binding TAKOSUMI_ACCOUNTS_DB (account-plane document buckets)
  #   deploy   — binding TAKOSUMI_CONTROL_DB (deploy-control OpenTofu run ledger)
  d1_databases = {
    db       = "${var.project_name}-db"
    accounts = "${var.project_name}-accounts"
    deploy   = "${var.project_name}-deploy"
  }

  r2_buckets = {
    worker_bundles = "${var.project_name}-worker-bundles"
    tenant_builds  = "${var.project_name}-tenant-builds"
    tenant_source  = "${var.project_name}-tenant-source"
    git_objects    = "${var.project_name}-git-objects"
    offload        = "${var.project_name}-offload"
    # Account-plane export download artifacts — binding
    # TAKOSUMI_ACCOUNTS_EXPORTS.
    accounts_exports = "${var.project_name}-accounts-exports"
    # Deploy-control OpenTofu plan artifacts — binding R2_ARTIFACTS. The
    # runner resolves the bucket NAME from env R2_ARTIFACTS_BUCKET_NAME and
    # falls back to the fixed default "takos-artifacts"
    # (takosumi/worker/src/durable/OpenTofuRunnerObject.ts
    # DEFAULT_PLAN_ARTIFACT_BUCKET). For the default project_name "takos" this
    # expands to exactly "takos-artifacts" (the default); for a non-default
    # project_name set R2_ARTIFACTS_BUCKET_NAME to this bucket's name.
    artifacts = "${var.project_name}-artifacts"
  }

  # Queue NAMES are free-form; the worker reaches them by BINDING name, so the
  # names are parameterized under project_name. Logical key -> binding:
  #   runs            RUN_QUEUE          | runs_dlq            (DLQ for runs)
  #   index_jobs      INDEX_QUEUE        | index_jobs_dlq      (DLQ)
  #   workflow        WORKFLOW_QUEUE     | workflow_dlq        (DLQ)
  #   deployment      DEPLOY_QUEUE       | deployment_dlq      (DLQ)
  #
  # The embedded Takosumi deploy-control plane does not get a separate queue in
  # the self-host Takos worker. The Takosumi controller falls back to its inline
  # dispatcher and drives the RUNNER Durable Object directly, while RUN_QUEUE
  # remains the Takos agent runtime queue.
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
}

# D1 databases — bindings DB, TAKOSUMI_ACCOUNTS_DB, TAKOSUMI_CONTROL_DB
resource "cloudflare_d1_database" "this" {
  for_each   = local.d1_databases
  account_id = var.account_id
  name       = each.value
}

# KV namespaces — bindings HOSTNAME_ROUTING, ROLLOUT_HEALTH_KV
resource "cloudflare_workers_kv_namespace" "this" {
  for_each   = local.kv_namespaces
  account_id = var.account_id
  title      = each.value
}

# R2 buckets — bindings WORKER_BUNDLES, TENANT_BUILDS, TENANT_SOURCE,
# GIT_OBJECTS, TAKOS_OFFLOAD, TAKOSUMI_ACCOUNTS_EXPORTS, R2_ARTIFACTS
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
# The cloudflare/cloudflare v5 provider has no managed resource for Vectorize
# indexes; the index is created out-of-band (wrangler `vectorize create` /
# Cloudflare API as part of the ProviderConnection / ProviderBinding /
# policy-controlled apply flow). Its expected name is exported below so the
# binding map stays complete.
