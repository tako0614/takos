terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # State backend and provider credentials are resolved by Takosumi ProviderConnection / ProviderBinding / policy during the typed Run. Takosumi records StateVersion, Output, and audit/run evidence after a successful apply.
}

provider "cloudflare" {
  # Credentials are supplied outside the module by Takosumi ProviderConnection
  # env injection.
}

module "takos" {
  source = "../../modules/cloudflare"

  account_id   = var.account_id
  project_name = "takos"
  environment  = "production"
}

variable "account_id" {
  type = string
}

variable "release_working_directory" {
  type    = string
  default = "."
}

variable "takosumi_source_repo_url" {
  type    = string
  default = "https://github.com/tako0614/takosumi.git"
}

variable "takosumi_source_ref" {
  type    = string
  default = "main"
}

variable "manage_vectorize_index" {
  type    = bool
  default = true
}

variable "wrangler_containers_rollout" {
  type    = string
  default = null
}

output "target" {
  value = "cloudflare"
}

output "cloudflare_account_id" {
  value = var.account_id
}

output "worker_name" {
  value = module.takos.worker_name
}

output "url" {
  value = module.takos.launch_url
}

output "launch_url" {
  value = module.takos.launch_url
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
          dimensions = 1536
          metric     = "cosine"
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

output "d1_database_id" {
  value = module.takos.d1_database_id
}

output "d1_database_name" {
  value = module.takos.d1_database_name
}

output "accounts_d1_database_id" {
  value = module.takos.accounts_d1_database_id
}

output "deploy_d1_database_id" {
  value = module.takos.deploy_d1_database_id
}

output "d1_database_ids" {
  value = module.takos.d1_database_ids
}

output "kv_namespace_ids" {
  value = module.takos.kv_namespace_ids
}

output "object_storage_buckets" {
  value = module.takos.r2_bucket_names
}

output "queue_bindings" {
  value = module.takos.queue_names
}

output "vectorize_index_name" {
  value = module.takos.vectorize_index_name
}

output "takosumi_release" {
  description = "Operator-side release activation commands Takosumi should run after a successful apply."
  value = {
    post_apply = [
      {
        id                = "takos-worker-release"
        executor          = "operator"
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production"]
        working_directory = var.release_working_directory
        env = merge({
          TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
          TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          TAKOS_MANAGE_VECTORIZE_INDEX    = tostring(var.manage_vectorize_index)
          }, var.wrangler_containers_rollout != null ? {
          TAKOS_WRANGLER_CONTAINERS_ROLLOUT = var.wrangler_containers_rollout
        } : {})
      },
    ]
    pre_destroy = [
      {
        id                = "takos-worker-destroy"
        executor          = "operator"
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production", "--destroy"]
        working_directory = var.release_working_directory
        env = merge({
          TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
          TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          TAKOS_MANAGE_VECTORIZE_INDEX    = tostring(var.manage_vectorize_index)
          }, var.wrangler_containers_rollout != null ? {
          TAKOS_WRANGLER_CONTAINERS_ROLLOUT = var.wrangler_containers_rollout
        } : {})
      },
    ]
  }
}
