terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

module "platform" {
  source = "./modules/platform"

  providers = {
    cloudflare = cloudflare
  }

  account_id        = var.cloudflare.account_id
  public_url        = var.public_url
  project_name      = var.project_name
  public_subdomain  = var.public_subdomain
  environment       = var.environment
  executor_capacity = var.executor_capacity
  plan_mode         = var.opentofu_plan_mode
  workers_subdomain = try(var.cloudflare.workers_subdomain, null)

  takosumi_accounts_url          = var.takosumi_accounts_url
  takosumi_accounts_issuer_url   = var.takosumi_accounts_issuer_url
  takosumi_accounts_client_id    = var.takosumi_accounts_client_id
  takosumi_accounts_redirect_uri = var.takosumi_accounts_redirect_uri
  env                            = var.env
}
