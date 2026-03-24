locals {
  gcs_buckets = {
    git-objects    = { versioning = true }
    offload        = { versioning = false }
    tenant-source  = { versioning = false }
    worker-bundles = { versioning = false }
    tenant-builds  = { versioning = false }
    ui-bundles     = { versioning = false }
  }
}

resource "google_storage_bucket" "main" {
  for_each = local.gcs_buckets

  name     = "${var.gcs_bucket_prefix}-${each.key}-${var.environment}"
  location = var.gcs_location
  project  = var.project_id

  uniform_bucket_level_access = true

  versioning {
    enabled = each.value.versioning
  }

  labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
  })
}
