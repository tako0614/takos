resource "google_sql_database_instance" "main" {
  name             = "${var.project_name}-${var.environment}-postgres"
  database_version = "POSTGRES_16"
  region           = var.region
  project          = var.project_id

  depends_on = [google_service_networking_connection.private_vpc_connection]

  settings {
    tier      = var.db_tier
    disk_size = var.db_disk_size
    disk_type = "PD_SSD"

    ip_configuration {
      ipv4_enabled                                  = false
      private_network                               = google_compute_network.main.id
      enable_private_path_for_google_cloud_services = true
    }

    backup_configuration {
      enabled                        = true
      start_time                     = "03:00"
      point_in_time_recovery_enabled = true
      backup_retention_settings {
        retained_backups = 7
      }
    }

    maintenance_window {
      day          = 7
      hour         = 4
      update_track = "stable"
    }

    database_flags {
      name  = "max_connections"
      value = "200"
    }

    user_labels = merge(var.labels, {
      environment = var.environment
      managed_by  = "terraform"
    })
  }

  deletion_protection = true
}

resource "google_sql_database" "main" {
  name     = var.project_name
  instance = google_sql_database_instance.main.name
  project  = var.project_id
}

resource "google_sql_user" "main" {
  name     = var.project_name
  instance = google_sql_database_instance.main.name
  password = var.db_password
  project  = var.project_id
}
