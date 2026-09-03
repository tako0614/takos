# The Cloudflare provider has no Vectorize resource, so the ordinary provider
# path cannot create the index this module names. A Worker Version that binds
# `VECTORIZE` anyway makes the Worker report `vectorSearch: vectorize` and then
# fail inside every vector call. These runs pin the rule that the binding
# appears only when some lane actually created the index.

run "the_default_lane_reports_the_declared_degraded_mode" {
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
    condition     = output.vector_search_capability == "disabled"
    error_message = "an install where nothing creates the Vectorize index must plan as the declared vectorSearch: disabled mode, not as a working vector deployment"
  }

  assert {
    condition     = output.vector_index_provisioned == false
    error_message = "the default install must not claim an externally created Vectorize index"
  }

  assert {
    condition     = output.cloudflare_vectorize_index_name != ""
    error_message = "the module must still name the index an operator has to create in order to leave the degraded mode"
  }
}

run "an_externally_created_index_turns_the_binding_on" {
  command = plan

  variables {
    project_name             = "takos-staging"
    public_url               = "https://takos-staging.example.com"
    opentofu_plan_mode       = true
    vector_index_provisioned = true
    cloudflare = {
      account_id = "00000000000000000000000000000000"
    }
  }

  assert {
    condition     = output.vector_search_capability == "vectorize"
    error_message = "an operator who created the index must get the VECTORIZE binding and the vectorize capability"
  }
}
