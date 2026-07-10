variable "account_id" {
  description = "Cloudflare account ID that owns the Takos backing resources."
  type        = string
}

variable "app_version" {
  description = "Takos product version projected through app_deployment. The root module derives it from the Git source package metadata."
  type        = string

  validation {
    condition     = can(regex("^[0-9]+\\.[0-9]+\\.[0-9]+([-+][0-9A-Za-z.-]+)?$", var.app_version))
    error_message = "app_version must be a SemVer version without a leading v."
  }
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

variable "public_url" {
  description = "Canonical public URL for the Takos worker. When unset, launch_url is derived from workers_subdomain."
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
