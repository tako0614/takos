run "child_module_resolves_app_root_artifacts" {
  command = plan

  assert {
    condition = alltrue([
      for digest in values(output.bridge_path_digests) : can(regex("^[a-f0-9]{64}$", digest))
    ])
    error_message = "generated-root child-module planning must hash every app-root bridge artifact"
  }

  assert {
    condition     = output.public_url == "https://takos-generated-root.example.com"
    error_message = "generated-root harness must pass the required canonical public_url input"
  }
}
