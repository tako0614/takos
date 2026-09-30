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

  # The names are not transcribed here: both sides are projections of
  # src/worker/shared/config/runtime-secrets.ts, so this asserts that the
  # module wires its own generated local through to the Output an operator
  # reads, rather than that someone typed the same five strings twice.
  assert {
    condition     = toset(output.runtime_secret_binding_names) == toset(local.runtime_secret_binding_names)
    error_message = "the Output an operator provisions from must be exactly the projected runtime secret name set"
  }

  assert {
    condition     = output.runtime_secrets_provisioned == true
    error_message = "an ordinary apply must carry the runtime secret bindings forward by default; a Worker Version's binding list is complete, so defaulting to false would publish a version without ENCRYPTION_KEY"
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

# Dropping the five bindings is legitimate exactly once, on the apply that
# happens before any value exists. Everywhere else it destroys the ability to
# read what ENCRYPTION_KEY encrypted, so it takes an exact acknowledgement.

run "dropping_the_bindings_without_the_acknowledgement_is_refused" {
  command = plan

  variables {
    project_name                = "takos-staging"
    public_url                  = "https://takos-staging.example.com"
    opentofu_plan_mode          = true
    runtime_secrets_provisioned = false
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  expect_failures = [
    var.first_install_acknowledgement,
  ]
}

run "a_declared_first_install_may_bind_nothing" {
  command = plan

  variables {
    project_name                  = "takos-staging"
    public_url                    = "https://takos-staging.example.com"
    opentofu_plan_mode            = true
    runtime_secrets_provisioned   = false
    first_install_acknowledgement = "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition     = output.runtime_secrets_provisioned == false
    error_message = "a declared first install must report that the Worker Version binds no runtime secret yet"
  }
}

run "a_first_install_waiver_may_not_survive_into_ordinary_applies" {
  command = plan

  variables {
    project_name                  = "takos-staging"
    public_url                    = "https://takos-staging.example.com"
    opentofu_plan_mode            = true
    runtime_secrets_provisioned   = true
    first_install_acknowledgement = "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  expect_failures = [
    var.first_install_acknowledgement,
  ]
}
