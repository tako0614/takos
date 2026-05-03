locals {
  pubsub_topics = [
    "takos-runs",
    "takos-index-jobs",
    "takos-workflow-jobs",
    "takos-deployment-jobs",
  ]
}

resource "google_pubsub_topic" "main" {
  for_each = toset(local.pubsub_topics)

  name    = "${each.value}-${var.environment}"
  project = var.project_id

  labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
  })
}

resource "google_pubsub_topic" "dead_letter" {
  for_each = toset(local.pubsub_topics)

  name    = "${each.value}-${var.environment}-dlq"
  project = var.project_id

  labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
    purpose     = "dead-letter"
  })
}

resource "google_pubsub_subscription" "main" {
  for_each = toset(local.pubsub_topics)

  name    = "${each.value}-${var.environment}-sub"
  topic   = google_pubsub_topic.main[each.value].id
  project = var.project_id

  ack_deadline_seconds = 60

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter[each.value].id
    max_delivery_attempts = 5
  }

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }

  labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
  })
}

resource "google_pubsub_subscription" "dead_letter" {
  for_each = toset(local.pubsub_topics)

  name    = "${each.value}-${var.environment}-dlq-sub"
  topic   = google_pubsub_topic.dead_letter[each.value].id
  project = var.project_id

  ack_deadline_seconds = 60

  labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
    purpose     = "dead-letter"
  })
}
