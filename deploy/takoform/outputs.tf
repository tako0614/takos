output "launch_url" {
  description = "Canonical Takos URL allocated by the selected Takoform host."
  value       = data.takoform_interface.app_http.resource_uri
}

output "public_url" {
  description = "Alias of launch_url for Takosumi's ordinary HTTP endpoint projection."
  value       = data.takoform_interface.app_http.resource_uri
}

output "resources" {
  description = "Provider-neutral logical resource identities."
  value = {
    app              = takoform_edge_worker.app.id
    database         = takoform_relational_database.database.id
    hostname_routing = takoform_key_value_store.hostname_routing.id
    buckets          = { for key, resource in takoform_object_bucket.buckets : key => resource.id }
    queues           = { for key, resource in takoform_queue.queues : key => resource.id }
    embeddings       = takoform_vector_index.embeddings.id
    stateful         = { for key, resource in takoform_stateful_entity.entities : key => resource.id }
    runtime          = takoform_container_service.runtime.id
    executors        = { for key, resource in takoform_container_service.executors : key => resource.id }
    schedules        = { for key, resource in takoform_schedule.maintenance : key => resource.id }
  }
}
