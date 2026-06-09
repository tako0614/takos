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
