# The bridge modes gate three imperative Cloudflare operations the provider
# cannot express: Vectorize index creation, the container-enabled Durable
# Object bootstrap upload, and Container application reconciliation. D1 schema
# is not among them, so an enabled bridge binds no migration-set digest and the
# module ships no SQL fixture for plan mode.
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

run "provider_gap_bridge_off_omits_executor_runtime_bindings" {
  command = plan

  module {
    source = "./modules/platform"
  }

  variables {
    account_id   = "00000000000000000000000000000000"
    project_name = "takos-bridge-off-executors"
    public_url   = "https://takos-bridge-off-executors.example.com"
    plan_mode    = true
    executor_capacity = {
      tier1_max_instances       = 1
      tier1_max_concurrent_runs = 4
      tier2_max_instances       = 1
      tier3_max_instances       = 1
      tier3_max_concurrent_runs = 1
    }
  }

  assert {
    condition     = length([for binding in cloudflare_worker_version.app.bindings : binding.name if startswith(binding.name, "EXECUTOR_CONTAINER")]) == 0
    error_message = "bridge-off Workers Versions must not advertise executor Container bindings"
  }

  assert {
    condition     = length(cloudflare_worker_version.app.containers) == 0 && length(cloudflare_worker_version.durable_object_migrations[0].containers) == 0
    error_message = "bridge-off migration and serving Versions must not carry Container metadata"
  }

  assert {
    condition = cloudflare_worker_version.durable_object_migrations[0].migrations.new_tag == "v7" && length(cloudflare_worker_version.durable_object_migrations[0].migrations.steps[5].new_sqlite_classes) == 4 && alltrue([
      for class_name in ["ExecutorContainerTier1", "ExecutorContainerTier2", "ExecutorContainerTier3", "TakosRuntimeContainer"] : contains(cloudflare_worker_version.durable_object_migrations[0].migrations.steps[5].new_sqlite_classes, class_name)
    ])
    error_message = "omitting Container metadata must retain the existing Durable Object migration history"
  }
}

run "provider_gap_bridge_enabled_keeps_executor_runtime_bindings" {
  command = plan

  module {
    source = "./modules/platform"
  }

  variables {
    account_id                          = "00000000000000000000000000000000"
    project_name                        = "takos-bridge-enabled-executors"
    public_url                          = "https://takos-bridge-enabled-executors.example.com"
    environment                         = "staging"
    plan_mode                           = true
    cloudflare_provider_gap_bridge_mode = "staging"
    container_image                     = "docker.io/library/alpine@sha256:2222222222222222222222222222222222222222222222222222222222222222"
    executor_capacity = {
      tier1_max_instances       = 1
      tier1_max_concurrent_runs = 4
      tier2_max_instances       = 1
      tier3_max_instances       = 1
      tier3_max_concurrent_runs = 1
    }
  }

  assert {
    condition = length([for binding in cloudflare_worker_version.app.bindings : binding.name if startswith(binding.name, "EXECUTOR_CONTAINER")]) == 3 && alltrue([
      for name in ["EXECUTOR_CONTAINER", "EXECUTOR_CONTAINER_TIER2", "EXECUTOR_CONTAINER_TIER3"] : contains([for binding in cloudflare_worker_version.app.bindings : binding.name], name)
    ])
    error_message = "an enabled provider-gap bridge must keep all three executor Container bindings"
  }

  assert {
    condition = length(cloudflare_worker_version.app.containers) == 3 && alltrue([
      for class_name in ["ExecutorContainerTier1", "ExecutorContainerTier2", "ExecutorContainerTier3"] : contains([for container in cloudflare_worker_version.app.containers : container.class_name], class_name)
    ])
    error_message = "an enabled provider-gap bridge must keep all three executor Container metadata entries"
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
