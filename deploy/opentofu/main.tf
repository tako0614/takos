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
  # Credentials are supplied outside the module by Takosumi ProviderConnection
  # env injection, or by the CI plan gate's temporary CLOUDFLARE_API_TOKEN.
}

module "cloudflare" {
  count  = var.target == "cloudflare" ? 1 : 0
  source = "./modules/cloudflare"

  account_id   = var.cloudflare.account_id
  project_name = var.project_name
  environment  = var.environment
  plan_mode    = var.opentofu_plan_mode
}
