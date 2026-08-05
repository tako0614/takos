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

variable "executor_capacity" {
  description = "Takos agent capacity materialized into the Worker and Cloudflare Container applications. Defaults fit a small self-host install; operators can raise the same limits explicitly."
  type = object({
    tier1_max_instances       = optional(number, 1)
    tier1_max_concurrent_runs = optional(number, 4)
    tier2_max_instances       = optional(number, 1)
    tier3_max_instances       = optional(number, 1)
    tier3_max_concurrent_runs = optional(number, 1)
  })
  default = {}

  validation {
    condition = alltrue([
      for value in [
        var.executor_capacity.tier1_max_instances,
        var.executor_capacity.tier1_max_concurrent_runs,
        var.executor_capacity.tier2_max_instances,
        var.executor_capacity.tier3_max_instances,
        var.executor_capacity.tier3_max_concurrent_runs,
      ] : value >= 1 && value <= 500 && floor(value) == value
    ])
    error_message = "executor_capacity values must be whole numbers between 1 and 500."
  }

  validation {
    condition = (
      var.executor_capacity.tier1_max_instances * var.executor_capacity.tier1_max_concurrent_runs +
      var.executor_capacity.tier3_max_instances * var.executor_capacity.tier3_max_concurrent_runs
    ) <= 250
    error_message = "executor_capacity total run concurrency must not exceed Cloudflare Queues max_concurrency 250."
  }
}

variable "opentofu_plan_mode" {
  description = "Use deterministic provider-free inputs for CI OpenTofu plan review. Do not use for apply."
  type        = bool
  default     = false
}

variable "public_url" {
  description = "Canonical public URL for the Takos worker. A hosting environment may supply its allocated URL; when unset in this direct adapter, launch_url is derived from cloudflare.workers_subdomain."
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
    account_id        = string
    workers_subdomain = optional(string)
  })

  validation {
    condition     = trimspace(var.cloudflare.account_id) != ""
    error_message = "cloudflare.account_id must be set."
  }

}
