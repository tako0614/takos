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

variable "runtime_secrets_provisioned" {
  description = "Whether the five Takos runtime secrets (ENCRYPTION_KEY, TAKOS_AGENT_START_TOKEN, TAKOS_INTERNAL_API_SECRET, PLATFORM_PRIVATE_KEY, PLATFORM_PUBLIC_KEY) already exist on the target Worker. This module never holds a runtime secret value, so it binds them with the Cloudflare `inherit` binding type, which carries an existing value forward without sending it. It defaults to true because a Worker Version's binding list is complete: an apply with this false publishes a version with no ENCRYPTION_KEY, and everything encrypted under it stays unreadable. Only a first install has nothing to inherit, and it must say so through first_install_acknowledgement."
  type        = bool
  default     = true
}

variable "first_install_acknowledgement" {
  description = "Exact acknowledgement that this apply is a first install with no runtime secret values yet: FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS. Required whenever runtime_secrets_provisioned is false, and it must be empty otherwise. Supply the five values out of band after the first apply, clear this, and apply again."
  type        = string
  default     = ""

  validation {
    condition     = var.first_install_acknowledgement == "" || var.first_install_acknowledgement == "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"
    error_message = "first_install_acknowledgement must be empty or exactly FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS."
  }

  validation {
    condition     = var.runtime_secrets_provisioned || var.first_install_acknowledgement == "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"
    error_message = "runtime_secrets_provisioned = false drops every runtime secret binding from the next Worker Version, including ENCRYPTION_KEY, and everything encrypted under it stays unreadable. Only a first install may do that, and it must set first_install_acknowledgement = \"FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS\"."
  }

  validation {
    condition     = !var.runtime_secrets_provisioned || var.first_install_acknowledgement == ""
    error_message = "first_install_acknowledgement must be empty once runtime_secrets_provisioned is true; leaving it set would carry a first-install waiver into ordinary applies."
  }
}

variable "vector_index_provisioned" {
  description = "Set to true only when the Vectorize index named by the `cloudflare_vectorize_index_name` Output already exists in this account. The Cloudflare provider cannot create a Vectorize index, so this module cannot create one on the ordinary provider path; binding `VECTORIZE` to an index that does not exist would make the Worker report `vectorSearch: vectorize` and then fail inside every vector call. Left false, the Worker Version omits the binding and the deployment runs in the declared `vectorSearch: disabled` mode. The provider-gap bridge creates the index itself and turns the binding on without this input."
  type        = bool
  default     = false
}

variable "opentofu_plan_mode" {
  description = "Use deterministic provider-free inputs for CI OpenTofu plan review. Do not use for apply."
  type        = bool
  default     = false
}

variable "public_url" {
  description = "Canonical HTTPS origin for the Takos worker. This value is required so the Worker endpoint and OIDC callback are plan-known."
  type        = string

  validation {
    condition = can(regex(
      "^https://[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$",
      var.public_url,
    ))
    error_message = "public_url must be an HTTPS origin without credentials, a port, path, query, or fragment."
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
      !contains(concat([
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
      ], local.runtime_secret_binding_names), name)
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
    zone_id           = optional(string)
    zone_name         = optional(string)
  })

  validation {
    condition     = trimspace(var.cloudflare.account_id) != ""
    error_message = "cloudflare.account_id must be set."
  }

}

variable "cloudflare_provider_gap_bridge_mode" {
  description = "Explicit app-owned Cloudflare provider-gap bridge mode. `off` is the default; `staging` requires environment `staging` for smoke inputs; `disposable-production` requires environment `production` for a one-shot disposable production E2E lane."
  type        = string
  default     = "off"

  validation {
    condition     = contains(["off", "staging", "disposable-production"], var.cloudflare_provider_gap_bridge_mode)
    error_message = "cloudflare_provider_gap_bridge_mode must be exactly off, staging, or disposable-production."
  }
}

variable "cloudflare_provider_gap_bridge_acknowledgement" {
  description = "Exact reviewed acknowledgement for the disposable-production Cloudflare provider-gap bridge in environment `production`: DISPOSABLE_PRODUCTION_ONE_SHOT. Keep empty for off or staging."
  type        = string
  default     = ""

  validation {
    condition     = var.cloudflare_provider_gap_bridge_acknowledgement == "" || var.cloudflare_provider_gap_bridge_acknowledgement == "DISPOSABLE_PRODUCTION_ONE_SHOT"
    error_message = "cloudflare_provider_gap_bridge_acknowledgement must be empty or exactly DISPOSABLE_PRODUCTION_ONE_SHOT."
  }
}

variable "container_image" {
  description = "Optional immutable Container image reference. Use an account-owned Cloudflare registry digest or a public Docker Hub digest when the Cloudflare provider-gap bridge is enabled."
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
