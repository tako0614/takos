terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

provider "cloudflare" {
  # Real credential is supplied by Takosumi Connection/CapabilityBinding/policy during the typed Run;
  # plan mode uses a deterministic 40-char placeholder for credential-free
  # reviewed `plan` Run (the provider validates token shape, not auth, at configure).
  api_token = var.opentofu_plan_mode ? "abcdef0123456789abcdef0123456789abcdef01" : null
}

module "cloudflare" {
  count  = var.target == "cloudflare" ? 1 : 0
  source = "./modules/cloudflare"

  account_id   = var.cloudflare.account_id
  project_name = var.project_name
  environment  = var.environment
  plan_mode    = var.opentofu_plan_mode
}
