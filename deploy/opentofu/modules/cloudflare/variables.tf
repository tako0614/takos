variable "account_id" {
  description = "Cloudflare account ID that owns the Takos backing resources."
  type        = string
}

variable "project_name" {
  description = "Resource name prefix (e.g. takos-private). Backing resources are named <prefix>-*."
  type        = string
  default     = "takos"
}

variable "environment" {
  description = "Deployment environment (production | staging)."
  type        = string
  default     = "production"
}

variable "plan_mode" {
  description = "Plan-only mode: no real Cloudflare credentials required (for Takosumi Run with type `plan` review)."
  type        = bool
  default     = false
}

variable "workers_subdomain" {
  description = "Optional workers.dev subdomain used to project a public launch URL for smoke/release verification."
  type        = string
  default     = null
}

variable "app_url" {
  description = "Canonical public URL for the Takos worker. When unset, launch_url is derived from workers_subdomain."
  type        = string
  default     = null

  validation {
    condition     = var.app_url == null || can(regex("^https://[^[:space:]]+$", var.app_url))
    error_message = "app_url must be unset or an https URL."
  }
}
