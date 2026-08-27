variable "account_id" {
  description = "Cloudflare account ID that owns the Takos backing resources."
  type        = string
}

variable "project_name" {
  description = "Resource name prefix (e.g. takos-private). Backing resources are named <prefix>-*."
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
  description = "Deployment environment (production | staging)."
  type        = string
  default     = "production"
}

variable "executor_capacity" {
  description = "Agent capacity projected into the Takos Worker and Cloudflare Container applications."
  type = object({
    tier1_max_instances       = number
    tier1_max_concurrent_runs = number
    tier2_max_instances       = number
    tier3_max_instances       = number
    tier3_max_concurrent_runs = number
  })
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

variable "zone_id" {
  description = "Optional Cloudflare zone ID used to attach the Worker to a custom route."
  type        = string
  default     = null
}

variable "zone_name" {
  description = "Optional Cloudflare zone name reserved for caller-side route discovery."
  type        = string
  default     = null
}

variable "enable_imperative_staging_bridge" {
  description = "Opt in to app-owned staging bridges for Cloudflare provider gaps (Vectorize, D1 migrations, and Container applications)."
  type        = bool
  default     = false
}

variable "container_image" {
  description = "Optional immutable Container image reference. Use an account-owned Cloudflare registry digest or a public Docker Hub digest when the staging bridge is enabled."
  type        = string
  default     = ""

  validation {
    condition = var.container_image == "" || can(regex(
      "^(registry\\.cloudflare\\.com/[0-9a-f]{32}/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*|docker\\.io/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?(?:/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)*)@sha256:[a-f0-9]{64}$",
      var.container_image,
    ))
    error_message = "container_image must be empty or an immutable registry.cloudflare.com/<32-hex-account>/...@sha256:<64-hex> or docker.io/...@sha256:<64-hex> reference."
  }
}

variable "public_url" {
  description = "Canonical HTTPS origin for the Takos worker. Root adapters pass this as a plan-known value; direct child callers may omit it to derive workers.dev."
  type        = string
  default     = null

  validation {
    condition = var.public_url == null || can(regex(
      "^https://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$",
      var.public_url,
    ))
    error_message = "public_url must be unset or an HTTPS origin without credentials, a port, path, query, or fragment."
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
        "ASSETS",
        "DB",
        "HOSTNAME_ROUTING",
        "WORKER_BUNDLES",
        "TENANT_BUILDS",
        "TENANT_SOURCE",
        "GIT_OBJECTS",
        "TAKOS_OFFLOAD",
        "RUN_QUEUE",
        "INDEX_QUEUE",
        "TAKOS_NOTIFICATION_PUSH_QUEUE",
        "VECTORIZE",
        "AI",
        "SESSION_DO",
        "RUN_NOTIFIER",
        "NOTIFICATION_NOTIFIER",
        "RATE_LIMITER_DO",
        "ROUTING_DO",
        "EXECUTOR_CONTAINER",
        "EXECUTOR_CONTAINER_TIER2",
        "EXECUTOR_CONTAINER_TIER3",
        "TAKOS_EGRESS",
        "ENCRYPTION_KEY",
        "TAKOS_AGENT_START_TOKEN",
        "TAKOS_INTERNAL_API_SECRET",
        "PLATFORM_PRIVATE_KEY",
        "PLATFORM_PUBLIC_KEY",
      ], name)
    ])
    error_message = "env keys must be uppercase Worker plain-text variable names and must not be secret-like or reserved by the Takos Cloudflare module."
  }
}

variable "takosumi_accounts_redirect_uri" {
  description = "Optional Takosumi Accounts OIDC redirect URI. When unset, it is derived from public_url when available."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.takosumi_accounts_redirect_uri) == "" || can(regex("^https://[^[:space:]]+$", trimspace(var.takosumi_accounts_redirect_uri)))
    error_message = "takosumi_accounts_redirect_uri must be empty or an https URL."
  }
}
