variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "asia-northeast1"
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "takos"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"
}

variable "db_tier" {
  description = "Cloud SQL instance tier"
  type        = string
  default     = "db-custom-2-8192"
}

variable "db_disk_size" {
  description = "Cloud SQL disk size in GB"
  type        = number
  default     = 50
}

variable "db_password" {
  description = "Cloud SQL database password"
  type        = string
  sensitive   = true
}

variable "redis_memory_size_gb" {
  description = "Memorystore Redis memory size in GB"
  type        = number
  default     = 1
}

variable "redis_tier" {
  description = "Memorystore Redis tier"
  type        = string
  default     = "BASIC"
}

variable "gcs_bucket_prefix" {
  description = "Prefix for GCS bucket names"
  type        = string
  default     = "takos"
}

variable "gcs_location" {
  description = "GCS bucket location"
  type        = string
  default     = "ASIA-NORTHEAST1"
}

variable "labels" {
  description = "Labels to apply to all resources"
  type        = map(string)
  default     = {}
}
