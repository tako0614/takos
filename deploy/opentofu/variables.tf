variable "target" {
  description = "Cloud target to compose. Supported values: cloudflare."
  type        = string
  default     = "cloudflare"

  validation {
    condition     = contains(["cloudflare"], var.target)
    error_message = "target must be cloudflare."
  }
}

variable "project_name" {
  description = "Project name used for resource naming."
  type        = string
  default     = "takos"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "production"
}

variable "release_working_directory" {
  description = "Source-root relative directory where Takos release commands run."
  type        = string
  default     = "."
}

variable "takosumi_source_repo_url" {
  description = "Takosumi source module Git URL used by the Takos release activation when no sibling checkout exists in the runner snapshot."
  type        = string
  default     = "https://github.com/tako0614/takosumi.git"
}

variable "takosumi_source_ref" {
  description = "Takosumi source module Git ref used by the Takos release activation."
  type        = string
  default     = "main"
}

variable "manage_vectorize_index" {
  description = "When true, the post-apply release command creates and destroys the Vectorize index. Set false when the operator provisions the exported index name outside the release command."
  type        = bool
  default     = true
}

variable "wrangler_containers_rollout" {
  description = "Optional value passed to wrangler deploy --containers-rollout during release activation. Use \"none\" when container image rollout is managed outside the first synchronous deploy."
  type        = string
  default     = null
}

variable "opentofu_plan_mode" {
  description = "Use deterministic provider-free inputs for CI OpenTofu plan review. Do not use for apply."
  type        = bool
  default     = false
}

variable "cloudflare" {
  description = "Cloudflare-specific backing-resource settings (provisioned by Takosumi Run with type `apply`)."
  type = object({
    account_id        = optional(string, "takos-placeholder")
    workers_subdomain = optional(string)
  })
  default = {}

  validation {
    condition     = var.target != "cloudflare" || var.cloudflare.account_id != "takos-placeholder"
    error_message = "cloudflare.account_id must be set when target is cloudflare."
  }
}
