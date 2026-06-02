terraform {
  required_version = ">= 1.5"
}

variable "environment" {
  type    = string
  default = "production"
}

variable "admin_domain" {
  type    = string
  default = "admin.takos.example.internal"
}

variable "tenant_base_domain" {
  type    = string
  default = "app.takos.example.internal"
}

variable "accounts_domain" {
  type    = string
  default = "accounts.takos.example.internal"
}

variable "ingress_class_name" {
  type    = string
  default = "caddy"
}

variable "tls_secret_name" {
  type    = string
  default = "takos-tls"
}

variable "platform_secret_name" {
  type    = string
  default = "takos-platform"
}

variable "auth_secret_name" {
  type    = string
  default = "takos-auth"
}

variable "llm_secret_name" {
  type    = string
  default = "takos-llm"
}

locals {
  domains = {
    admin      = var.admin_domain
    tenantBase = var.tenant_base_domain
    accounts   = var.accounts_domain
  }

  existing_secrets = {
    platform = var.platform_secret_name
    auth     = var.auth_secret_name
    llm      = var.llm_secret_name
  }

  platform_services = {
    accountIssuer = {
      kind = "oidc-issuer"
      path = "workload.oidc.takosumi-accounts"
      url  = "https://${var.accounts_domain}"
    }
    ingress = {
      kind      = "ingress"
      className = var.ingress_class_name
    }
    secrets = {
      kind  = "kubernetes-secrets"
      names = local.existing_secrets
    }
  }

  helm_values = {
    domains = local.domains
    runtimeConfig = {
      environment         = var.environment
      publicRoutesEnabled = true
      defaultApps = {
        preinstallEnabled = false
      }
      plugins = {
        auth            = ""
        notification    = ""
        operator-config = ""
        storage         = ""
        source          = ""
        provider        = ""
        queue           = ""
        object-storage  = ""
        kms             = ""
        secret-store    = ""
        router-config   = ""
        observability   = ""
        runtime-agent   = ""
      }
    }
    secrets = {
      create          = false
      existingSecrets = local.existing_secrets
    }
    accounts = {
      issuer      = "https://${var.accounts_domain}"
      redirectUri = "https://${var.admin_domain}/auth/oidc/callback"
      persistence = {
        enabled               = true
        runMigrations         = false
        databaseUrlSecretName = var.platform_secret_name
        databaseUrlSecretKey  = "TAKOSUMI_ACCOUNTS_DATABASE_URL"
      }
    }
    ingress = {
      enabled     = true
      className   = var.ingress_class_name
      annotations = {}
      tls = {
        enabled    = true
        secretName = var.tls_secret_name
      }
    }
    serviceAccount = {
      create      = true
      annotations = {}
    }
  }
}

output "target" {
  description = "Self-hosted target id."
  value       = "selfhosted"
}

output "platform_services" {
  description = "Operator-owned platform services consumed by Takos workloads."
  value       = local.platform_services
}

output "helm_values" {
  description = "Credential-free Helm values overlay for the self-hosted target."
  value       = local.helm_values
}
