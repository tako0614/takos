terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    http = {
      source  = "hashicorp/http"
      version = "~> 3.5"
    }
  }
}

locals {
  # Keep the installable module self-contained: Takosumi may extract only this
  # module path from the reviewed Git snapshot.
  app_version                       = "0.10.32"
  container_image_ref_pattern       = "^(registry\\.cloudflare\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9._/-]+(@sha256:[0-9a-f]{64}|:[A-Za-z0-9_][A-Za-z0-9._-]{0,127})|(docker\\.io/[A-Za-z0-9._/-]+|[0-9]{12}\\.dkr\\.ecr\\.[A-Za-z0-9-]+\\.amazonaws\\.com/[A-Za-z0-9._/-]+|[A-Za-z0-9-]+-docker\\.pkg\\.dev/[A-Za-z0-9._/-]+)@sha256:[0-9a-f]{64})$"
  worker_release_tag                = trimspace(var.worker_release_tag)
  worker_release_explicit_url       = trimspace(var.worker_release_artifact_url)
  worker_release_uses_manifest      = local.worker_release_explicit_url == "" && local.worker_release_tag != ""
  worker_release_manifest_url       = local.worker_release_uses_manifest ? "https://github.com/tako0614/takos/releases/download/${local.worker_release_tag}/takosumi-artifact.json" : ""
  worker_release_manifest           = local.worker_release_uses_manifest ? jsondecode(data.http.worker_release_manifest[0].response_body) : null
  worker_release_artifact_url       = var.build_from_source ? "" : (local.worker_release_explicit_url != "" ? local.worker_release_explicit_url : try(local.worker_release_manifest.artifact.url, ""))
  worker_release_artifact_sha256    = var.build_from_source ? "" : (trimspace(var.worker_release_artifact_sha256) != "" ? trimspace(var.worker_release_artifact_sha256) : try(local.worker_release_manifest.artifact.sha256, ""))
  manifest_release_container_images = local.worker_release_uses_manifest ? try(tomap(local.worker_release_manifest.containerImages), {}) : {}
  release_container_images          = merge(local.manifest_release_container_images, var.release_container_images)
  has_runtime_container_image       = anytrue([for key in ["runtime", "TakosRuntimeContainer", "takos-worker-runtime"] : contains(keys(local.release_container_images), key)])
  has_executor_container_image = anytrue([for key in ["executor", "takos-agent"] : contains(keys(local.release_container_images), key)]) || alltrue([
    for key in ["ExecutorContainerTier1", "ExecutorContainerTier2", "ExecutorContainerTier3"] : contains(keys(local.release_container_images), key)
  ])
}

data "http" "worker_release_manifest" {
  count              = local.worker_release_uses_manifest ? 1 : 0
  url                = local.worker_release_manifest_url
  request_timeout_ms = 30000

  request_headers = {
    Accept = "application/json"
  }

  retry {
    attempts     = 3
    min_delay_ms = 500
    max_delay_ms = 5000
  }
}

check "worker_release_manifest" {
  assert {
    condition = !local.worker_release_uses_manifest || (
      try(local.worker_release_manifest.kind, "") == "takosumi.worker-artifact@v1" &&
      try(local.worker_release_manifest.app, "") == "takos" &&
      try(local.worker_release_manifest.releaseTag, "") == local.worker_release_tag
    )
    error_message = "worker_release_tag must resolve to a matching takosumi.worker-artifact@v1 release manifest."
  }
}

check "worker_release_artifact" {
  assert {
    condition = var.build_from_source || (
      can(regex("^https://[^[:space:]]+$", local.worker_release_artifact_url)) &&
      can(regex("^(sha256:)?[a-f0-9]{64}$", local.worker_release_artifact_sha256))
    )
    error_message = "Takos installs require a valid takosumi.worker-artifact@v1 URL and SHA-256, or build_from_source=true."
  }
}

check "source_build_artifact_override" {
  assert {
    condition     = !var.build_from_source || local.worker_release_explicit_url == ""
    error_message = "build_from_source and worker_release_artifact_url are mutually exclusive. Use worker_release_tag only to reuse its prebuilt container images."
  }
}

check "release_container_images" {
  assert {
    condition = alltrue([
      for image in values(local.release_container_images) :
      can(regex(local.container_image_ref_pattern, image))
    ])
    error_message = "The selected release manifest contains an invalid container image ref."
  }
}

check "operator_release_container_images" {
  assert {
    condition     = var.release_executor != "operator" || (local.has_runtime_container_image && local.has_executor_container_image)
    error_message = "release_executor=operator requires prebuilt runtime and executor container images from worker_release_tag or release_container_images."
  }
}

check "source_build_companion_pin" {
  assert {
    condition     = !var.build_from_source || trimspace(var.takosumi_source_ref) != ""
    error_message = "build_from_source requires an immutable takosumi_source_ref tag or commit."
  }
}

module "cloudflare" {
  count  = var.target == "cloudflare" ? 1 : 0
  source = "./modules/cloudflare"

  providers = {
    cloudflare = cloudflare
  }

  account_id        = var.cloudflare.account_id
  app_version       = local.app_version
  public_url        = var.public_url
  project_name      = var.project_name
  public_subdomain  = var.public_subdomain
  environment       = var.environment
  executor_capacity = var.executor_capacity
  plan_mode         = var.opentofu_plan_mode
  workers_subdomain = try(var.cloudflare.workers_subdomain, null)

  takosumi_accounts_url          = var.takosumi_accounts_url
  takosumi_accounts_issuer_url   = var.takosumi_accounts_issuer_url
  takosumi_accounts_client_id    = var.takosumi_accounts_client_id
  takosumi_accounts_redirect_uri = var.takosumi_accounts_redirect_uri
  env                            = var.env
}
