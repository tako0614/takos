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

variable "release_containers_rollout" {
  type    = string
  default = null

  validation {
    condition     = var.release_containers_rollout == null || contains(["immediate", "gradual", "none"], var.release_containers_rollout)
    error_message = "release_containers_rollout must be immediate, gradual, none, or null."
  }
}

variable "release_container_images" {
  type    = map(string)
  default = {}

  validation {
    condition = alltrue([
      for image in values(var.release_container_images) :
      can(regex("@sha256:[0-9a-f]{64}$", image))
    ])
    error_message = "release_container_images values must be digest-pinned image refs ending with @sha256:<64-hex>."
  }
}

variable "release_executor" {
  type    = string
  default = "runner"

  validation {
    condition     = contains(["runner", "operator"], var.release_executor)
    error_message = "release_executor must be runner or operator."
  }
}

variable "takosumi_source_repo_url" {
  type    = string
  default = "https://github.com/tako0614/takosumi.git"
}

variable "takosumi_source_ref" {
  type    = string
  default = "main"
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
      vector = {
        type = "vector-index"
        bind = "VECTORIZE"
        to   = ["web"]
        vectorIndex = {
          dimensions = module.takos.vectorize_index_dimensions
          metric     = module.takos.vectorize_index_metric
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

output "vectorize_index_dimensions" {
  value = module.takos.vectorize_index_dimensions
}

output "vectorize_index_metric" {
  value = module.takos.vectorize_index_metric
}

output "cloudflare_vectorize_index_name" {
  value = module.takos.vectorize_index_name
}

output "cloudflare_vectorize_index_dimensions" {
  value = module.takos.vectorize_index_dimensions
}

output "cloudflare_vectorize_index_metric" {
  value = module.takos.vectorize_index_metric
}

output "takosumi_release" {
  description = "Operator-side release activation commands Takosumi should run after a successful apply."
  value = {
    post_apply = [
      {
        id                = "takos-worker-release"
        executor          = var.release_executor
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production"]
        working_directory = var.release_working_directory
        timeout_seconds   = 1200
        env = merge(
          {
            TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
            TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          },
          var.release_containers_rollout == null ? {} : {
            TAKOS_WRANGLER_CONTAINERS_ROLLOUT = var.release_containers_rollout
          },
          length(var.release_container_images) == 0 ? {} : {
            TAKOS_RELEASE_CONTAINER_IMAGES_JSON = jsonencode(var.release_container_images)
          },
        )
      },
    ]
    pre_destroy = [
      {
        id                = "takos-worker-destroy"
        executor          = var.release_executor
        command           = ["bun", "scripts/control/takosumi-release.mjs", "production", "--destroy"]
        working_directory = var.release_working_directory
        timeout_seconds   = 600
        env = merge(
          {
            TAKOS_RELEASE_TAKOSUMI_REPO_URL = var.takosumi_source_repo_url
            TAKOS_RELEASE_TAKOSUMI_REF      = var.takosumi_source_ref
          },
          var.release_containers_rollout == null ? {} : {
            TAKOS_WRANGLER_CONTAINERS_ROLLOUT = var.release_containers_rollout
          },
        )
      },
    ]
  }
}
