################################################################################
# DynamoDB KV Store
################################################################################

resource "aws_dynamodb_table" "kv" {
  name         = "${var.dynamo_kv_table_name}-${var.environment}"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiration"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(var.tags, {
    Name        = "${var.dynamo_kv_table_name}-${var.environment}"
    Environment = var.environment
  })
}
