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

variable "public_subdomain" {
  description = "Optional public subdomain label. When unset, project_name is used."
  type        = string
  default     = null

  validation {
    condition     = var.public_subdomain == null || trimspace(var.public_subdomain) == "" || can(regex("^[a-z0-9][a-z0-9-]{0,62}$", trimspace(var.public_subdomain)))
    error_message = "public_subdomain must be unset or a lowercase DNS label using letters, numbers, and hyphens."
  }
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
  description = "Optional prebuilt Cloudflare Containers image refs produced by Git CI or an operator release pipeline. Cloudflare managed registry refs may use CI-published tags or digest refs; external registry refs must be digest-pinned. Keys may be runtime/executor aliases or Wrangler container class names. When unset, the release activator builds from the Git source snapshot."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for image in values(var.release_container_images) :
      can(regex("^(registry\\.cloudflare\\.com/[A-Za-z0-9_-]+/[A-Za-z0-9._/-]+(@sha256:[0-9a-f]{64}|:[A-Za-z0-9_][A-Za-z0-9._-]{0,127})|(docker\\.io/[A-Za-z0-9._/-]+|[0-9]{12}\\.dkr\\.ecr\\.[A-Za-z0-9-]+\\.amazonaws\\.com/[A-Za-z0-9._/-]+|[A-Za-z0-9-]+-docker\\.pkg\\.dev/[A-Za-z0-9._/-]+)@sha256:[0-9a-f]{64})$", image))
    ])
    error_message = "release_container_images values must use Cloudflare managed registry tag/digest refs or digest-pinned external registry refs."
  }
}

variable "release_executor" {
  description = "Executor for Takosumi release activation commands. Defaults to operator for hosted Takosumi Cloud materializers; set runner only when the runner environment intentionally owns wrangler deploy."
  type        = string
  default     = "operator"

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
  description = "Takosumi source module Git tag or commit used by the Takos release activation. Hosted releases must pass an explicit immutable ref."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_source_ref) != ""
    error_message = "takosumi_source_ref is required. Pass a release tag or commit instead of relying on a mutable default."
  }
}

variable "opentofu_plan_mode" {
  description = "Use deterministic provider-free inputs for CI OpenTofu plan review. Do not use for apply."
  type        = bool
  default     = false
}

variable "public_url" {
  description = "Canonical public URL for the Takos worker. Takosumi Cloud managed installs set this to an app.takos.jp URL; when unset, launch_url is derived from cloudflare.workers_subdomain."
  type        = string
  default     = null

  validation {
    condition     = var.public_url == null || can(regex("^https://[^[:space:]]+$", var.public_url))
    error_message = "public_url must be unset or an https URL."
  }
}

variable "takosumi_accounts_url" {
  description = "Optional Takosumi Accounts/control-plane URL consumed by the Takos Worker for OIDC and Capsule projection APIs."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takosumi_accounts_url)))
    error_message = "takosumi_accounts_url must be empty or an https URL."
  }
}

variable "takosumi_accounts_issuer_url" {
  description = "Optional Takosumi Accounts OIDC issuer URL consumed by the Takos Worker."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_issuer_url) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takosumi_accounts_issuer_url)))
    error_message = "takosumi_accounts_issuer_url must be empty or an https URL."
  }
}

variable "takosumi_accounts_client_id" {
  description = "Optional Takosumi Accounts public OIDC client id issued for this Takos Capsule."
  type        = string
  default     = ""
}

variable "env" {
  description = "Additional non-secret Takos Worker environment variables projected into the release activation env. Secrets must use dedicated sensitive variables or Provider Connections."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for name, value in var.env :
      can(regex("^[A-Z_][A-Z0-9_]{0,127}$", name)) &&
      !can(regex("(SECRET|TOKEN|PASSWORD|CREDENTIAL|PRIVATE_?KEY|API_?KEY)", upper(name))) &&
      !contains([
        "TAKOSUMI_ACCOUNTS_URL",
        "OIDC_ISSUER_URL",
        "OIDC_CLIENT_ID",
        "OIDC_REDIRECT_URI",
      ], name)
    ])
    error_message = "env keys must be uppercase Worker plain-text variable names and must not be secret-like or reserved by the Takos module."
  }
}

variable "takosumi_accounts_redirect_uri" {
  description = "Optional Takosumi Accounts OIDC redirect URI. When unset, the Cloudflare module derives <public_url>/auth/oidc/callback when public_url is available."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_redirect_uri) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takosumi_accounts_redirect_uri)))
    error_message = "takosumi_accounts_redirect_uri must be empty or an https URL."
  }
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
