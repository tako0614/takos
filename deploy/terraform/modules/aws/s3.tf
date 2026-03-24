################################################################################
# Locals – bucket names
################################################################################

locals {
  s3_buckets = {
    git-objects    = { versioning = true }
    offload        = { versioning = false }
    tenant-source  = { versioning = false }
    worker-bundles = { versioning = false }
    tenant-builds  = { versioning = false }
    ui-bundles     = { versioning = false }
  }
}

################################################################################
# S3 Buckets
################################################################################

resource "aws_s3_bucket" "main" {
  for_each = local.s3_buckets

  bucket = "${var.s3_bucket_prefix}-${each.key}-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = merge(var.tags, {
    Name        = "${var.s3_bucket_prefix}-${each.key}-${var.environment}"
    Environment = var.environment
  })
}

################################################################################
# Versioning
################################################################################

resource "aws_s3_bucket_versioning" "main" {
  for_each = local.s3_buckets

  bucket = aws_s3_bucket.main[each.key].id

  versioning_configuration {
    status = each.value.versioning ? "Enabled" : "Suspended"
  }
}

################################################################################
# Server-Side Encryption (AES256)
################################################################################

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  for_each = local.s3_buckets

  bucket = aws_s3_bucket.main[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

################################################################################
# Block All Public Access
################################################################################

resource "aws_s3_bucket_public_access_block" "main" {
  for_each = local.s3_buckets

  bucket = aws_s3_bucket.main[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
