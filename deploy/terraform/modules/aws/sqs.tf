################################################################################
# Locals – queue names
################################################################################

locals {
  sqs_queues = [
    "takos-runs",
    "takos-index-jobs",
    "takos-workflow-jobs",
    "takos-deployment-jobs",
  ]
}

################################################################################
# Dead Letter Queues
################################################################################

resource "aws_sqs_queue" "dlq" {
  for_each = toset(local.sqs_queues)

  name                      = "${each.value}-${var.environment}-dlq"
  message_retention_seconds = var.sqs_message_retention * 2

  tags = merge(var.tags, {
    Name        = "${each.value}-${var.environment}-dlq"
    Environment = var.environment
  })
}

################################################################################
# Main Queues
################################################################################

resource "aws_sqs_queue" "main" {
  for_each = toset(local.sqs_queues)

  name                      = "${each.value}-${var.environment}"
  message_retention_seconds = var.sqs_message_retention
  visibility_timeout_seconds = 60

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq[each.value].arn
    maxReceiveCount     = 3
  })

  tags = merge(var.tags, {
    Name        = "${each.value}-${var.environment}"
    Environment = var.environment
  })
}
