# CI-only plan fixture. Do not use for apply.
target              = "gcp"
environment         = "staging"
db_password         = "ci-plan-placeholder-not-a-secret"
opentofu_plan_mode = true

gcp = {
  project_id           = "takos-staging"
  region               = "asia-northeast1"
  db_tier              = "db-custom-1-3840"
  db_disk_size         = 20
  redis_memory_size_gb = 1
  redis_tier           = "BASIC"
  gcs_bucket_prefix    = "takos-staging"
  gcs_location         = "ASIA-NORTHEAST1"
}
