variable "host" {
  description = "Bare origin of the Takoform Host used by the experimental tracer."
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", trimspace(var.host))) || can(regex("^http://(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::[0-9]+)?$", trimspace(var.host)))
    error_message = "host must be an HTTPS bare origin (the tracer accepts loopback HTTP for local diagnostics)."
  }
}

variable "space" {
  description = "Explicit Host SpaceID for the five resources."
  type        = string

  validation {
    condition     = length(trimspace(var.space)) > 0 && !can(regex("[[:cntrl:]/]", var.space))
    error_message = "space must be a non-empty SpaceID without control characters or slashes."
  }
}

variable "project_name" {
  description = "Runner-generated isolated project name shared by the five tracer resources."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,62}$", var.project_name))
    error_message = "project_name must be a lowercase DNS-like resource name."
  }
}

variable "config_value" {
  description = "One deliberately non-secret value projected into the Worker."
  type        = string
  default     = "fetch-tracer-config-v1"

  validation {
    condition     = length(var.config_value) > 0 && length(var.config_value) <= 256 && !can(regex("[[:cntrl:]]", var.config_value))
    error_message = "config_value must be a short non-secret string."
  }
}
