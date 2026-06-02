terraform {
  required_version = ">= 1.5"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Cloudflare backing resources for Takos, provisioned by Takosumi (ApplyRun).
# This module owns the durable backing infrastructure only — the equivalent of
# the AWS RDS/SQS/S3 and GCP CloudSQL/PubSub/GCS modules. The four Worker
# scripts + Durable Objects + service bindings + routes (the app-runtime layer,
# incl. the trust-boundary invariants in docs/architecture/internal-trust-
# boundaries.md) consume the IDs exported below and are deployed on top, exactly
# as Helm consumes the AWS/GCP outputs.

locals {
  name = var.project_name

  r2_buckets = {
    worker_bundles = "${var.project_name}-worker-bundles"
    tenant_builds  = "${var.project_name}-tenant-builds"
    tenant_source  = "${var.project_name}-tenant-source"
    git_objects    = "${var.project_name}-git-objects"
    offload        = "${var.project_name}-offload"
  }

  queues = {
    runs       = "${var.project_name}-runs"
    index_jobs = "${var.project_name}-index-jobs"
    workflow   = "${var.project_name}-workflow-jobs"
    deployment = "${var.project_name}-deployment-jobs"
  }

  kv_namespaces = {
    hostname_routing = "${var.project_name}-hostname-routing"
    rollout_health   = "${var.project_name}-rollout-health"
  }
}

# Control-plane database — binding DB
resource "cloudflare_d1_database" "main" {
  account_id = var.account_id
  name       = "${var.project_name}-db"
}

# KV namespaces — bindings HOSTNAME_ROUTING, ROLLOUT_HEALTH_KV
resource "cloudflare_workers_kv_namespace" "this" {
  for_each   = local.kv_namespaces
  account_id = var.account_id
  title      = each.value
}

# R2 buckets — bindings WORKER_BUNDLES, TENANT_BUILDS, TENANT_SOURCE, GIT_OBJECTS, TAKOS_OFFLOAD
resource "cloudflare_r2_bucket" "this" {
  for_each   = local.r2_buckets
  account_id = var.account_id
  name       = each.value
}

# Queues — bindings RUN_QUEUE, INDEX_QUEUE, WORKFLOW_QUEUE, DEPLOY_QUEUE
resource "cloudflare_queue" "this" {
  for_each   = local.queues
  account_id = var.account_id
  queue_name = each.value
}

# Vectorize index — binding VECTORIZE.
# The cloudflare/cloudflare v5 provider has no managed resource for Vectorize
# indexes; the index is created out-of-band (wrangler `vectorize create` /
# Cloudflare API as part of the RunnerProfile's apply hooks). Its expected name
# is exported below so the binding map stays complete.
