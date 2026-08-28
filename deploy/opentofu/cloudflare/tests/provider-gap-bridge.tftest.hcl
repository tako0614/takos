run "provider_gap_bridge_defaults_off" {
  command = plan

  variables {
    project_name       = "takos-bridge-default-off"
    public_url         = "https://takos-bridge-default-off.example.com"
    opentofu_plan_mode = true
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition     = output.cloudflare_provider_gap_bridge_mode == "off"
    error_message = "the Cloudflare provider-gap bridge must default to off"
  }

  assert {
    condition     = output.bridge_helper_digest == "bridge-disabled"
    error_message = "the disabled bridge must not hash or execute helper inputs"
  }
}

run "provider_gap_bridge_staging_is_explicit" {
  command = plan

  variables {
    project_name                        = "takos-bridge-staging"
    public_url                          = "https://takos-bridge-staging.example.com"
    environment                         = "staging"
    opentofu_plan_mode                  = true
    cloudflare_provider_gap_bridge_mode = "staging"
    container_image                     = "docker.io/library/alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition     = output.cloudflare_provider_gap_bridge_mode == "staging"
    error_message = "staging mode must be visible in the root output"
  }

  assert {
    condition     = output.bridge_helper_digest != "bridge-disabled"
    error_message = "an explicitly enabled bridge must bind its helper digest"
  }

  assert {
    condition     = output.container_rendered_input_digest != "bridge-disabled"
    error_message = "an explicitly enabled bridge must bind rendered Container inputs"
  }
}

run "provider_gap_bridge_rendered_inputs_include_image_and_capacity" {
  command = plan

  variables {
    project_name                        = "takos-bridge-rendered-inputs"
    public_url                          = "https://takos-bridge-rendered-inputs.example.com"
    environment                         = "staging"
    opentofu_plan_mode                  = true
    cloudflare_provider_gap_bridge_mode = "staging"
    container_image                     = "docker.io/library/alpine@sha256:1111111111111111111111111111111111111111111111111111111111111111"
    executor_capacity = {
      tier1_max_instances       = 3
      tier1_max_concurrent_runs = 4
      tier2_max_instances       = 2
      tier3_max_instances       = 5
      tier3_max_concurrent_runs = 1
    }
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition = output.container_rendered_input_digest == sha256(jsonencode({
      template_digest = output.container_desired_config_digest
      worker_name     = "takos-bridge-rendered-inputs"
      image           = "docker.io/library/alpine@sha256:1111111111111111111111111111111111111111111111111111111111111111"
      executor_capacity = {
        tier1_max_instances = 3
        tier2_max_instances = 2
        tier3_max_instances = 5
      }
    }))
    error_message = "rendered-input identity must include the template, image, worker name, and executor capacities"
  }
}

run "provider_gap_bridge_rejects_wrong_production_acknowledgement" {
  command = plan

  variables {
    project_name                                   = "takos-bridge-production-missing-ack"
    public_url                                     = "https://takos-bridge-production-missing-ack.example.com"
    environment                                    = "production"
    opentofu_plan_mode                             = true
    cloudflare_provider_gap_bridge_mode            = "disposable-production"
    cloudflare_provider_gap_bridge_acknowledgement = "reviewed"
    container_image                                = "docker.io/library/alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  expect_failures = [var.cloudflare_provider_gap_bridge_acknowledgement]
}

run "provider_gap_bridge_rejects_acknowledgement_outside_disposable_production" {
  command = plan

  variables {
    project_name                                   = "takos-bridge-staging-with-ack"
    public_url                                     = "https://takos-bridge-staging-with-ack.example.com"
    environment                                    = "staging"
    opentofu_plan_mode                             = true
    cloudflare_provider_gap_bridge_mode            = "staging"
    cloudflare_provider_gap_bridge_acknowledgement = "reviewed"
    container_image                                = "docker.io/library/alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  expect_failures = [var.cloudflare_provider_gap_bridge_acknowledgement]
}

run "provider_gap_bridge_disposable_production_accepts_exact_acknowledgement" {
  command = plan

  variables {
    project_name                                   = "takos-bridge-production-reviewed"
    public_url                                     = "https://takos-bridge-production-reviewed.example.com"
    environment                                    = "production"
    opentofu_plan_mode                             = true
    cloudflare_provider_gap_bridge_mode            = "disposable-production"
    cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"
    container_image                                = "docker.io/library/alpine@sha256:0000000000000000000000000000000000000000000000000000000000000000"
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition     = output.cloudflare_provider_gap_bridge_mode == "disposable-production"
    error_message = "the reviewed disposable-production mode must be accepted"
  }
}
