run "short_project_names_keep_readable_queue_names" {
  command = plan

  variables {
    project_name       = "takos-staging"
    opentofu_plan_mode = true
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition     = output.queues.notification_push_dlq == "takos-staging-notification-push-dlq"
    error_message = "short project names must keep the existing readable queue name"
  }
}

run "maximum_length_capsule_name_keeps_all_queues_provider_safe" {
  command = plan

  variables {
    # Exercise the module's raw input boundary beyond Takosumi's ordinary
    # 48-character Capsule-derived name so direct OpenTofu callers are safe too.
    project_name       = "staging-takos-e2e-capsule-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    opentofu_plan_mode = true
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition = alltrue([
      for name in values(output.queues) :
      length(name) <= 62 && can(regex("^[a-z0-9][a-z0-9-]{0,60}[a-z0-9]$", name))
    ])
    error_message = "every queue name must remain a valid Cloudflare name below 63 characters"
  }

  assert {
    condition     = length(output.queues.notification_push_dlq) == 62
    error_message = "the longest queue suffix should use the full bounded name budget"
  }

  assert {
    condition     = can(regex("-[0-9a-f]{12}-notification-push-dlq$", output.queues.notification_push_dlq))
    error_message = "bounded queue names must retain a stable digest before the logical suffix"
  }

  assert {
    condition     = length(distinct(values(output.queues))) == 6
    error_message = "bounded queue names must remain unique across all logical queues"
  }
}
