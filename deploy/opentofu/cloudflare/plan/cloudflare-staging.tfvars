# CI-only plan fixture. Do not use for apply.
environment        = "staging"
project_name       = "takos-staging"
public_url         = "https://takos-staging.example.com"
opentofu_plan_mode = true
cloudflare = {
  account_id = "00000000000000000000000000000000"
}
