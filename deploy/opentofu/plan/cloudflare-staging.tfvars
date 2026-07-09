# CI-only plan fixture. Do not use for apply.
target             = "cloudflare"
environment        = "staging"
project_name       = "takos-staging"
opentofu_plan_mode = true
build_from_source  = true
worker_release_tag = ""
release_executor   = "runner"

cloudflare = {
  account_id = "00000000000000000000000000000000"
}
