# Provider 4.0.0 public-registry tracer only. This module is intentionally not
# referenced by Takos's default deployment surface or product runtime.

terraform {
  required_version = ">= 1.5"

  required_providers {
    takoform = {
      source  = "registry.terraform.io/tako0614/takoform"
      version = "= 4.0.0"
    }
  }
}

provider "takoform" {
  endpoint = var.host
  space    = var.space
}

resource "takoform_module_worker" "app" {
  name  = var.project_name
  space = var.space
}

resource "takoform_worker_bundle" "app" {
  revision_owner = var.project_name
  space          = var.space
  main_module    = "worker.mjs"

  modules = [
    {
      name         = "worker.mjs"
      content_type = "application/javascript+module"
      content_file = "${path.module}/worker.mjs"
    }
  ]

  lifecycle {
    create_before_destroy = true
  }
}

resource "takoform_worker_version" "app" {
  revision_owner = var.project_name
  space          = var.space
  worker         = takoform_module_worker.app.name
  bundle         = takoform_worker_bundle.app.name
  handlers       = ["fetch"]
  vars_json = jsonencode({
    TAKOS_FETCH_TRACER_CONFIG      = var.config_value
    TAKOS_FETCH_TRACER_NONCE       = var.project_nonce
    TAKOS_FETCH_TRACER_PROJECT_UID = var.project_uid
  })

  required_sensitive_vars = []

  lifecycle {
    create_before_destroy = true
  }
}

resource "takoform_worker_deployment" "app" {
  name   = "${var.project_name}-deployment"
  space  = var.space
  worker = takoform_module_worker.app.name

  versions = [
    {
      worker_version = takoform_worker_version.app.name
      weight         = 10000
    }
  ]
}

resource "takoform_worker_endpoint" "app" {
  name   = "${var.project_name}-endpoint"
  space  = var.space
  worker = takoform_module_worker.app.name

  depends_on = [takoform_worker_deployment.app]
}
