terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

data "aws_caller_identity" "current" {
  count = var.plan_mode && var.aws_account_id != "" ? 0 : 1
}

locals {
  aws_account_id = var.plan_mode && var.aws_account_id != "" ? var.aws_account_id : data.aws_caller_identity.current[0].account_id
}
