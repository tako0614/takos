output "target" {
  description = "Selected cloud target."
  value       = var.target
}

output "database_endpoint" {
  description = "Non-secret D1 database id for the selected target."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : null
}

# Cloudflare-specific binding map (OutputSnapshot consumed by the Worker-script layer).

output "cloudflare_account_id" {
  description = "Cloudflare account ID the resources were provisioned in (for the CF_ACCOUNT_ID worker var)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].account_id : null
}

output "worker_name" {
  description = "Worker script name rendered into wrangler.toml by the release activation step."
  value       = var.target == "cloudflare" ? module.cloudflare[0].worker_name : null
}

output "url" {
  description = "Public URL for smoke checks when cloudflare.workers_subdomain is supplied."
  value       = var.target == "cloudflare" ? module.cloudflare[0].launch_url : null
}

output "launch_url" {
  description = "Alias of url for Takosumi public output projection."
  value       = var.target == "cloudflare" ? module.cloudflare[0].launch_url : null
}

output "app_deployment" {
  description = "Installable Takos app declaration consumed from tofu output -json by Takosumi install flows."
  value = {
    contractVersion = 1
    name            = "takos"
    version         = "0.10.0"

    compute = {
      web = {
        kind      = "worker"
        readiness = "/health"
        triggers = {
          queues = [
            {
              binding         = "RUN_QUEUE"
              deadLetterQueue = "runs_dlq"
            },
            {
              binding         = "INDEX_QUEUE"
              deadLetterQueue = "index_jobs_dlq"
            },
            {
              binding         = "WORKFLOW_QUEUE"
              deadLetterQueue = "workflow_dlq"
            },
            {
              binding         = "DEPLOY_QUEUE"
              deadLetterQueue = "deployment_dlq"
            },
          ]
        }
      }
    }

    resources = {
      db = {
        type = "sql"
        bind = "DB"
        to   = ["web"]
      }
      accounts = {
        type = "sql"
        bind = "TAKOSUMI_ACCOUNTS_DB"
        to   = ["web"]
      }
      deploy_control = {
        type = "sql"
        bind = "TAKOSUMI_CONTROL_DB"
        to   = ["web"]
      }
      hostname_routing = {
        type = "key-value"
        bind = "HOSTNAME_ROUTING"
        to   = ["web"]
      }
      rollout_health = {
        type = "key-value"
        bind = "ROLLOUT_HEALTH_KV"
        to   = ["web"]
      }
      worker_bundles = {
        type = "object-store"
        bind = "WORKER_BUNDLES"
        to   = ["web"]
      }
      tenant_builds = {
        type = "object-store"
        bind = "TENANT_BUILDS"
        to   = ["web"]
      }
      tenant_source = {
        type = "object-store"
        bind = "TENANT_SOURCE"
        to   = ["web"]
      }
      git_objects = {
        type = "object-store"
        bind = "GIT_OBJECTS"
        to   = ["web"]
      }
      offload = {
        type = "object-store"
        bind = "TAKOS_OFFLOAD"
        to   = ["web"]
      }
      accounts_exports = {
        type = "object-store"
        bind = "TAKOSUMI_ACCOUNTS_EXPORTS"
        to   = ["web"]
      }
      artifacts = {
        type = "object-store"
        bind = "R2_ARTIFACTS"
        to   = ["web"]
      }
      vector = {
        type = "vector-index"
        bind = "VECTORIZE"
        to   = ["web"]
        vectorIndex = {
          dimensions = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_dimensions : null
          metric     = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_metric : null
        }
      }
      runs = {
        type = "queue"
        bind = "RUN_QUEUE"
        to   = ["web"]
        queue = {
          deadLetterQueue = "runs_dlq"
        }
      }
      index_jobs = {
        type = "queue"
        bind = "INDEX_QUEUE"
        to   = ["web"]
        queue = {
          deadLetterQueue = "index_jobs_dlq"
        }
      }
      workflow = {
        type = "queue"
        bind = "WORKFLOW_QUEUE"
        to   = ["web"]
        queue = {
          deadLetterQueue = "workflow_dlq"
        }
      }
      deployment = {
        type = "queue"
        bind = "DEPLOY_QUEUE"
        to   = ["web"]
        queue = {
          deadLetterQueue = "deployment_dlq"
        }
      }
    }

    routes = [
      {
        id     = "root"
        target = "web"
        path   = "/"
      },
    ]

    publish = [
      {
        name      = "launcher"
        publisher = "web"
        type      = "interface.ui.surface"
        outputs = {
          url = {
            kind     = "url"
            routeRef = "root"
          }
        }
        display = {
          title       = "Takos"
          description = "Self-hostable AI workspace with chat, agents, memory, Git, storage, and app launcher."
          category    = "workspace"
        }
        spec = {
          launcher = true
        }
      },
    ]

    env = {}
  }
}

output "cloudflare_d1_database_id" {
  description = "D1 database ID for the DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_id : null
}

output "cloudflare_accounts_d1_database_id" {
  description = "D1 database ID for the TAKOSUMI_ACCOUNTS_DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].accounts_d1_database_id : null
}

output "cloudflare_deploy_d1_database_id" {
  description = "D1 database ID for the TAKOSUMI_CONTROL_DB binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].deploy_d1_database_id : null
}

output "cloudflare_d1_database_ids" {
  description = "All D1 database IDs by logical binding: db, accounts, deploy (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].d1_database_ids : null
}

output "cloudflare_kv_namespace_ids" {
  description = "KV namespace IDs by logical binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].kv_namespace_ids : null
}

output "cloudflare_vectorize_index_name" {
  description = "Vectorize index name for the VECTORIZE binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_name : null
}

output "cloudflare_vectorize_index_dimensions" {
  description = "Vector dimensions for the VECTORIZE binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_dimensions : null
}

output "cloudflare_vectorize_index_metric" {
  description = "Vector distance metric for the VECTORIZE binding (cloudflare target)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].vectorize_index_metric : null
}

output "object_storage_buckets" {
  description = "R2 bucket names for Git, bundles, builds, and offload data."
  value       = var.target == "cloudflare" ? module.cloudflare[0].r2_bucket_names : null
}

output "queue_bindings" {
  description = "Queue bindings for Takos product jobs (runs, index, workflow, deployment)."
  value       = var.target == "cloudflare" ? module.cloudflare[0].queue_names : null
}

output "takosumi_release" {
  description = "Operator-side release activation commands Takosumi should run after a successful apply."
  value = {
    post_apply = [
      {
        id                = "takos-worker-release"
        executor          = "runner"
        command           = ["bun", "scripts/control/takosumi-release.mjs", var.environment]
        working_directory = var.release_working_directory
        timeout_seconds   = 1200
        env = {
          TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
          TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
        }
      },
    ]
    pre_destroy = [
      {
        id                = "takos-worker-destroy"
        executor          = "runner"
        command           = ["bun", "scripts/control/takosumi-release.mjs", var.environment, "--destroy"]
        working_directory = var.release_working_directory
        timeout_seconds   = 600
        env = {
          TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
          TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
        }
      },
    ]
  }
}
