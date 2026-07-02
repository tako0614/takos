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

variable "release_containers_rollout" {
  description = "Optional wrangler --containers-rollout value for Takos release activation. Set to none in runner sandboxes that cannot build or publish Cloudflare Containers."
  type        = string
  default     = null

  validation {
    condition     = var.release_containers_rollout == null || contains(["immediate", "gradual", "none"], var.release_containers_rollout)
    error_message = "release_containers_rollout must be immediate, gradual, none, or null."
  }
}

variable "release_container_images" {
  description = "Optional prebuilt Cloudflare Containers image refs produced by Git CI or an operator release pipeline. Keys may be runtime/executor aliases or Wrangler container class names. When unset, the release activator builds from the Git source snapshot."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for image in values(var.release_container_images) :
      can(regex("^(registry\\.cloudflare\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9._/-]+|docker\\.io/[A-Za-z0-9._/-]+|[0-9]{12}\\.dkr\\.ecr\\.[A-Za-z0-9-]+\\.amazonaws\\.com/[A-Za-z0-9._/-]+|[A-Za-z0-9-]+-docker\\.pkg\\.dev/[A-Za-z0-9._/-]+)(@sha256:[0-9a-f]{64}|:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})$", image))
    ])
    error_message = "release_container_images values must use Cloudflare Containers-supported registry refs."
  }
}

variable "release_executor" {
  description = "Executor for Takosumi release activation commands. Use operator for hosted Takosumi Cloud materializers; use runner only when the runner environment can run wrangler deploy."
  type        = string
  default     = "runner"

  validation {
    condition     = contains(["runner", "operator"], var.release_executor)
    error_message = "release_executor must be runner or operator."
  }
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
