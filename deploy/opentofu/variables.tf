variable "target" {
  description = "Cloud target to compose. Supported values: aws, gcp, cloudflare."
  type        = string

  validation {
    condition     = contains(["aws", "gcp", "cloudflare"], var.target)
    error_message = "target must be one of: aws, gcp, cloudflare."
  }
}

variable "project_name" {
  description = "Project name used for resource naming."
  type        = string
  default     = "takos"
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "production"
}

variable "db_username" {
  description = "PostgreSQL master username."
  type        = string
  default     = "takos"
}

variable "db_password" {
  description = "PostgreSQL master password (aws/gcp only). Production secrets are supplied by the operator environment. Not used by the cloudflare target (D1 has no master password)."
  type        = string
  sensitive   = true
  default     = ""

  validation {
    condition     = var.target == "cloudflare" || var.db_password != ""
    error_message = "db_password must be set when target is aws or gcp."
  }
}

variable "opentofu_plan_mode" {
  description = "Use deterministic provider-free inputs for CI OpenTofu plan review. Do not use for apply."
  type        = bool
  default     = false
}

variable "aws" {
  description = "AWS-specific infrastructure settings."
  type = object({
    region                = optional(string, "ap-northeast-1")
    vpc_cidr              = optional(string, "10.0.0.0/16")
    db_instance_class     = optional(string, "db.t4g.medium")
    db_allocated_storage  = optional(number, 50)
    redis_node_type       = optional(string, "cache.t4g.medium")
    redis_num_cache_nodes = optional(number, 1)
    s3_bucket_prefix      = optional(string, "takos")
    sqs_message_retention = optional(number, 345600)
    dynamo_kv_table_name  = optional(string, "takos-kv")
    ecs_cluster_name      = optional(string, "takos")
    tags                  = optional(map(string), {})
  })
  default = {}
}

variable "gcp" {
  description = "GCP-specific infrastructure settings."
  type = object({
    project_id           = optional(string, "takos-placeholder")
    region               = optional(string, "asia-northeast1")
    db_tier              = optional(string, "db-custom-2-8192")
    db_disk_size         = optional(number, 50)
    redis_memory_size_gb = optional(number, 1)
    redis_tier           = optional(string, "BASIC")
    gcs_bucket_prefix    = optional(string, "takos")
    gcs_location         = optional(string, "ASIA-NORTHEAST1")
    labels               = optional(map(string), {})
  })
  default = {}

  validation {
    condition     = var.target != "gcp" || var.gcp.project_id != "takos-placeholder"
    error_message = "gcp.project_id must be set when target is gcp."
  }
}

variable "cloudflare" {
  description = "Cloudflare-specific backing-resource settings (provisioned by Takosumi ApplyRun)."
  type = object({
    account_id = optional(string, "takos-placeholder")
  })
  default = {}

  validation {
    condition     = var.target != "cloudflare" || var.cloudflare.account_id != "takos-placeholder"
    error_message = "cloudflare.account_id must be set when target is cloudflare."
  }
}
