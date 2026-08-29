locals {
  module_worker_identity = {
    name                    = takoform_module_worker.app.name
    space                   = takoform_module_worker.app.space
    uid                     = takoform_module_worker.app.uid
    generation              = takoform_module_worker.app.generation
    revision                = takoform_module_worker.app.revision
    ready                   = takoform_module_worker.app.ready
    form_api_version        = takoform_module_worker.app.form_api_version
    form_kind               = takoform_module_worker.app.form_kind
    form_definition_version = takoform_module_worker.app.form_definition_version
    form_schema_digest      = takoform_module_worker.app.form_schema_digest
    hostname                = null
    url                     = null
  }

  worker_bundle_identity = {
    name                    = takoform_worker_bundle.app.name
    space                   = takoform_worker_bundle.app.space
    uid                     = takoform_worker_bundle.app.uid
    generation              = takoform_worker_bundle.app.generation
    revision                = takoform_worker_bundle.app.revision
    ready                   = takoform_worker_bundle.app.ready
    form_api_version        = takoform_worker_bundle.app.form_api_version
    form_kind               = takoform_worker_bundle.app.form_kind
    form_definition_version = takoform_worker_bundle.app.form_definition_version
    form_schema_digest      = takoform_worker_bundle.app.form_schema_digest
    hostname                = null
    url                     = null
  }

  worker_version_identity = {
    name                    = takoform_worker_version.app.name
    space                   = takoform_worker_version.app.space
    uid                     = takoform_worker_version.app.uid
    generation              = takoform_worker_version.app.generation
    revision                = takoform_worker_version.app.revision
    ready                   = takoform_worker_version.app.ready
    form_api_version        = takoform_worker_version.app.form_api_version
    form_kind               = takoform_worker_version.app.form_kind
    form_definition_version = takoform_worker_version.app.form_definition_version
    form_schema_digest      = takoform_worker_version.app.form_schema_digest
    hostname                = null
    url                     = null
  }

  worker_deployment_identity = {
    name                    = takoform_worker_deployment.app.name
    space                   = takoform_worker_deployment.app.space
    uid                     = takoform_worker_deployment.app.uid
    generation              = takoform_worker_deployment.app.generation
    revision                = takoform_worker_deployment.app.revision
    ready                   = takoform_worker_deployment.app.ready
    form_api_version        = takoform_worker_deployment.app.form_api_version
    form_kind               = takoform_worker_deployment.app.form_kind
    form_definition_version = takoform_worker_deployment.app.form_definition_version
    form_schema_digest      = takoform_worker_deployment.app.form_schema_digest
    hostname                = null
    url                     = null
  }

  worker_endpoint_identity = {
    name                    = takoform_worker_endpoint.app.name
    space                   = takoform_worker_endpoint.app.space
    uid                     = takoform_worker_endpoint.app.uid
    generation              = takoform_worker_endpoint.app.generation
    revision                = takoform_worker_endpoint.app.revision
    ready                   = takoform_worker_endpoint.app.ready
    form_api_version        = takoform_worker_endpoint.app.form_api_version
    form_kind               = takoform_worker_endpoint.app.form_kind
    form_definition_version = takoform_worker_endpoint.app.form_definition_version
    form_schema_digest      = takoform_worker_endpoint.app.form_schema_digest
    hostname                = takoform_worker_endpoint.app.hostname
    url                     = takoform_worker_endpoint.app.url
  }
}

output "resource_identities" {
  description = "The exact provider identities that the tracer reads back before destroy."
  value = {
    module_worker     = local.module_worker_identity
    worker_bundle     = local.worker_bundle_identity
    worker_version    = local.worker_version_identity
    worker_deployment = local.worker_deployment_identity
    worker_endpoint   = local.worker_endpoint_identity
  }
}

output "config_value" {
  description = "The non-secret value used by the Worker probe."
  value       = var.config_value
}

output "endpoint_url" {
  description = "The assigned endpoint URL, including diagnostic .invalid hosts when a Host uses them."
  value       = takoform_worker_endpoint.app.url
}

output "endpoint_hostname" {
  description = "The assigned endpoint hostname."
  value       = takoform_worker_endpoint.app.hostname
}

output "project_nonce" {
  description = "Per-run nonce echoed by the Worker for exact runtime correlation."
  value       = var.project_nonce
}

output "project_uid" {
  description = "Per-run nonce-derived project UID echoed by the Worker."
  value       = var.project_uid
}
