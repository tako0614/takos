terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

module "cloudflare" {
  count  = var.target == "cloudflare" ? 1 : 0
  source = "./modules/cloudflare"

  providers = {
    cloudflare = cloudflare
  }

  account_id        = var.cloudflare.account_id
  project_name      = var.project_name
  environment       = var.environment
  plan_mode         = var.opentofu_plan_mode
  workers_subdomain = try(var.cloudflare.workers_subdomain, null)
}
