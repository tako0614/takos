resource "google_redis_instance" "main" {
  name           = "${var.project_name}-${var.environment}-redis"
  tier           = var.redis_tier
  memory_size_gb = var.redis_memory_size_gb
  region         = var.region
  project        = var.project_id

  redis_version = "REDIS_7_0"

  authorized_network = google_compute_network.main.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  depends_on = [google_service_networking_connection.private_vpc_connection]

  labels = merge(var.labels, {
    environment = var.environment
    managed_by  = "terraform"
  })
}
