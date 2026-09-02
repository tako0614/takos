# The module names the Takos runtime secrets and never holds their values.
# scripts/test-opentofu.ts asserts the planned Worker Version bindings; these
# runs pin the Output contract an operator reads to know which values to supply.

run "runtime_secret_names_are_published_without_values" {
  command = plan

  variables {
    project_name       = "takos-staging"
    public_url         = "https://takos-staging.example.com"
    opentofu_plan_mode = true
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition = alltrue([
      for name in [
        "ENCRYPTION_KEY",
        "TAKOS_AGENT_START_TOKEN",
        "TAKOS_INTERNAL_API_SECRET",
        "PLATFORM_PRIVATE_KEY",
        "PLATFORM_PUBLIC_KEY",
      ] : contains(output.runtime_secret_binding_names, name)
    ])
    error_message = "every runtime secret the Takos Worker reads must be named in the Output an operator provisions from"
  }

  assert {
    condition     = length(output.runtime_secret_binding_names) == 5
    error_message = "the runtime secret name set must stay exactly the five names the Worker reads"
  }

  assert {
    condition     = output.runtime_secrets_provisioned == false
    error_message = "a first install must default to binding no runtime secret, because there is no previous Worker version to inherit one from"
  }
}

run "provisioned_installs_carry_the_names_forward" {
  command = plan

  variables {
    project_name                = "takos-staging"
    public_url                  = "https://takos-staging.example.com"
    opentofu_plan_mode          = true
    runtime_secrets_provisioned = true
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition     = output.runtime_secrets_provisioned == true
    error_message = "an operator-confirmed install must report that the Worker Version carries the runtime secret bindings forward"
  }
}
