# Database Reference

Takos control plane の canonical SQLite / D1 baseline schema です。このページは
baseline SQL から同期し、DB contract test で照合します。

```sql
-- CreateTable
CREATE TABLE account_blocks (
    "blocker_account_id" TEXT NOT NULL,
    "blocked_account_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("blocker_account_id", "blocked_account_id")
);

-- CreateTable
CREATE TABLE account_env_vars (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value_encrypted" TEXT NOT NULL,
    "is_secret" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_env_vars_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_follow_requests (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requester_account_id" TEXT NOT NULL,
    "target_account_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" DATETIME,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_follow_requests_target_account_id_fkey" FOREIGN KEY ("target_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "account_follow_requests_requester_account_id_fkey" FOREIGN KEY ("requester_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_follows (
    "follower_account_id" TEXT NOT NULL,
    "following_account_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("follower_account_id", "following_account_id"),
    CONSTRAINT "account_follows_following_account_id_fkey" FOREIGN KEY ("following_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "account_follows_follower_account_id_fkey" FOREIGN KEY ("follower_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_memberships (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "status" TEXT NOT NULL DEFAULT 'active',
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_memberships_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "account_memberships_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_metadata (
    "account_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("account_id", "key"),
    CONSTRAINT "account_metadata_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_moderation (
    "account_id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'active',
    "suspended_until" DATETIME,
    "warn_count" INTEGER NOT NULL DEFAULT 0,
    "last_warn_at" DATETIME,
    "banned_at" DATETIME,
    "reason" TEXT,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_moderation_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_mutes (
    "muter_account_id" TEXT NOT NULL,
    "muted_account_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("muter_account_id", "muted_account_id")
);

-- CreateTable
CREATE TABLE account_settings (
    "account_id" TEXT NOT NULL PRIMARY KEY,
    "setup_completed" INTEGER NOT NULL DEFAULT 0,
    "auto_update_enabled" INTEGER NOT NULL DEFAULT 1,
    "private_account" INTEGER NOT NULL DEFAULT 0,
    "activity_visibility" TEXT NOT NULL DEFAULT 'public',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_stats (
    "account_id" TEXT NOT NULL PRIMARY KEY,
    "file_count" INTEGER NOT NULL DEFAULT 0,
    "total_size_bytes" INTEGER NOT NULL DEFAULT 0,
    "snapshot_count" INTEGER NOT NULL DEFAULT 0,
    "blob_count" INTEGER NOT NULL DEFAULT 0,
    "last_calculated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_stats_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE account_storage_files (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "mime_type" TEXT,
    "r2_key" TEXT,
    "sha256" TEXT,
    "uploaded_by_account_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_storage_files_uploaded_by_account_id_fkey" FOREIGN KEY ("uploaded_by_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "account_storage_files_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "account_storage_files" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "account_storage_files_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE accounts (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL UNIQUE,
    "description" TEXT,
    "picture" TEXT,
    "bio" TEXT,
    "email" TEXT,
    "trust_tier" TEXT NOT NULL DEFAULT 'new',
    "setup_completed" INTEGER NOT NULL DEFAULT 0,
    "default_repository_id" TEXT,
    "google_sub" TEXT,
    "takos_auth_id" TEXT,
    "ai_model" TEXT DEFAULT 'gpt-5-mini',
    "model_backend" TEXT DEFAULT 'openai',
    "owner_account_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounts_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE auth_identities (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL REFERENCES "accounts"("id"),
    "provider" TEXT NOT NULL,
    "provider_sub" TEXT NOT NULL,
    "email_snapshot" TEXT,
    "email_kind" TEXT NOT NULL DEFAULT 'unknown',
    "linked_at" TEXT NOT NULL,
    "last_login_at" TEXT NOT NULL,
    "refresh_token_enc" TEXT
);

-- CreateTable
CREATE TABLE agent_tasks (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "created_by_account_id" TEXT,
    "thread_id" TEXT,
    "last_run_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "agent_type" TEXT NOT NULL DEFAULT 'default',
    "model" TEXT,
    "plan" TEXT,
    "due_at" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_tasks_last_run_id_fkey" FOREIGN KEY ("last_run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_tasks_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_tasks_created_by_account_id_fkey" FOREIGN KEY ("created_by_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "agent_tasks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE apps (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "worker_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "app_type" TEXT NOT NULL,
    "takos_client_key" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "apps_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "apps_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE artifacts (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'code',
    "title" TEXT,
    "content" TEXT,
    "file_id" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifacts_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "artifacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE auth_services (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "allowed_redirect_uris" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE auth_sessions (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE billing_accounts (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "balance_cents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'active',
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "subscription_started_at" TEXT,
    "subscription_period_end" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_accounts_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "billing_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE billing_plan_features (
    "plan_id" TEXT NOT NULL,
    "feature_key" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("plan_id", "feature_key"),
    CONSTRAINT "billing_plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE billing_plan_quotas (
    "plan_id" TEXT NOT NULL,
    "quota_key" TEXT NOT NULL,
    "limit_value" INTEGER NOT NULL,

    PRIMARY KEY ("plan_id", "quota_key"),
    CONSTRAINT "billing_plan_quotas_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE billing_plan_rates (
    "plan_id" TEXT NOT NULL,
    "meter_type" TEXT NOT NULL,
    "rate_cents" INTEGER NOT NULL,

    PRIMARY KEY ("plan_id", "meter_type"),
    CONSTRAINT "billing_plan_rates_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE billing_plans (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE billing_transactions (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billing_account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "balance_after_cents" INTEGER NOT NULL,
    "description" TEXT,
    "reference_id" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_transactions_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE blobs (
    "account_id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "is_binary" BOOLEAN NOT NULL DEFAULT false,
    "refcount" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("account_id", "hash"),
    CONSTRAINT "blobs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE branches (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "is_default" INTEGER NOT NULL DEFAULT 0,
    "is_protected" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "branches_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE bundle_deployment_events (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "bundle_deployment_id" TEXT,
    "name" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "bundle_key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "deploy_action" TEXT NOT NULL,
    "deployed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deployed_by_account_id" TEXT NOT NULL,
    "source_type" TEXT,
    "source_repo_id" TEXT,
    "source_tag" TEXT,
    "source_asset_id" TEXT,
    "replaced_bundle_deployment_id" TEXT,
    CONSTRAINT "bundle_deployment_events_replaced_bundle_deployment_id_fkey" FOREIGN KEY ("replaced_bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bundle_deployment_events_deployed_by_account_id_fkey" FOREIGN KEY ("deployed_by_account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bundle_deployment_events_bundle_deployment_id_fkey" FOREIGN KEY ("bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bundle_deployment_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE bundle_deployments (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "bundle_key" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "version_major" INTEGER NOT NULL DEFAULT 0,
    "version_minor" INTEGER NOT NULL DEFAULT 0,
    "version_patch" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "icon" TEXT,
    "manifest_json" TEXT NOT NULL,
    "deployed_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deployed_by_account_id" TEXT NOT NULL,
    "source_type" TEXT,
    "source_repo_id" TEXT,
    "source_tag" TEXT,
    "source_asset_id" TEXT,
    "oauth_client_id" TEXT,
    "is_locked" INTEGER NOT NULL DEFAULT 0,
    "locked_at" DATETIME,
    "locked_by_account_id" TEXT,
    CONSTRAINT "bundle_deployments_locked_by_account_id_fkey" FOREIGN KEY ("locked_by_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "bundle_deployments_deployed_by_account_id_fkey" FOREIGN KEY ("deployed_by_account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "bundle_deployments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE chunks (
    "id" TEXT NOT NULL PRIMARY KEY,
    "file_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "start_line" INTEGER NOT NULL,
    "end_line" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "vector_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chunks_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chunks_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE commits (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "tree_sha" TEXT NOT NULL,
    "parent_shas" TEXT,
    "author_name" TEXT NOT NULL,
    "author_email" TEXT NOT NULL,
    "author_date" DATETIME NOT NULL,
    "committer_name" TEXT NOT NULL,
    "committer_email" TEXT NOT NULL,
    "commit_date" DATETIME NOT NULL,
    "message" TEXT NOT NULL,
    CONSTRAINT "commits_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE common_env_audit_logs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "actor_account_id" TEXT,
    "actor_type" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "env_name" TEXT NOT NULL,
    "worker_id" TEXT,
    "link_source" TEXT,
    "change_before" TEXT NOT NULL DEFAULT '{}',
    "change_after" TEXT NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "common_env_audit_logs_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "common_env_audit_logs_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "common_env_audit_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE common_env_reconcile_jobs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "target_keys_json" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" DATETIME,
    "lease_token" TEXT,
    "lease_expires_at" DATETIME,
    "last_error_code" TEXT,
    "last_error_message" TEXT,
    "enqueued_at" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "common_env_reconcile_jobs_worker_id_account_id_fkey" FOREIGN KEY ("worker_id", "account_id") REFERENCES "workers" ("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "common_env_reconcile_jobs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE custom_domains (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "verification_token" TEXT NOT NULL,
    "verification_method" TEXT NOT NULL DEFAULT 'cname',
    "cf_custom_hostname_id" TEXT,
    "ssl_status" TEXT DEFAULT 'pending',
    "verified_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_domains_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE deployment_events (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deployment_id" TEXT NOT NULL,
    "actor_account_id" TEXT,
    "event_type" TEXT NOT NULL,
    "step_name" TEXT,
    "message" TEXT,
    "details" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deployment_events_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deployment_events_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE deployments (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "artifact_ref" TEXT,
    "bundle_r2_key" TEXT,
    "bundle_hash" TEXT,
    "bundle_size" INTEGER,
    "wasm_r2_key" TEXT,
    "wasm_hash" TEXT,
    "assets_manifest" TEXT,
    "runtime_config_snapshot_json" TEXT NOT NULL DEFAULT '{}',
    "bindings_snapshot_encrypted" TEXT,
    "env_vars_snapshot_encrypted" TEXT,
    "deploy_state" TEXT NOT NULL DEFAULT 'pending',
    "current_step" TEXT,
    "step_error" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "routing_status" TEXT NOT NULL DEFAULT 'archived',
    "routing_weight" INTEGER NOT NULL DEFAULT 0,
    "deployed_by" TEXT,
    "deploy_message" TEXT,
    "idempotency_key" TEXT,
    "is_rollback" INTEGER NOT NULL DEFAULT 0,
    "rollback_from_version" INTEGER,
    "rolled_back_at" DATETIME,
    "rolled_back_by" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deployments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deployments_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE edges (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1.0,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "nodes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "edges_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE file_handler_matchers (
    "file_handler_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    PRIMARY KEY ("file_handler_id", "kind", "value"),
    CONSTRAINT "file_handler_matchers_file_handler_id_fkey" FOREIGN KEY ("file_handler_id") REFERENCES "file_handlers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE file_handlers (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "bundle_deployment_id" TEXT NOT NULL,
    "worker_hostname" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "open_path" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "file_handlers_bundle_deployment_id_fkey" FOREIGN KEY ("bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "file_handlers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE files (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT,
    "mime_type" TEXT,
    "size" INTEGER NOT NULL DEFAULT 0,
    "origin" TEXT NOT NULL DEFAULT 'user',
    "kind" TEXT NOT NULL DEFAULT 'source',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "indexed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "files_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE git_commits (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "author_account_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "parent_id" TEXT,
    "files_changed" INTEGER NOT NULL DEFAULT 0,
    "insertions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    "tree_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "git_commits_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "git_commits" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "git_commits_author_account_id_fkey" FOREIGN KEY ("author_account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "git_commits_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE git_file_changes (
    "id" TEXT NOT NULL PRIMARY KEY,
    "commit_id" TEXT NOT NULL,
    "file_id" TEXT,
    "path" TEXT NOT NULL,
    "change_type" TEXT NOT NULL,
    "old_path" TEXT,
    "old_hash" TEXT,
    "new_hash" TEXT,
    "insertions" INTEGER NOT NULL DEFAULT 0,
    "deletions" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "git_file_changes_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "git_file_changes_commit_id_fkey" FOREIGN KEY ("commit_id") REFERENCES "git_commits" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE index_jobs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "total_files" INTEGER NOT NULL DEFAULT 0,
    "processed_files" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "index_jobs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE info_units (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "thread_id" TEXT,
    "run_id" TEXT,
    "session_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'session',
    "title" TEXT,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "segment_index" INTEGER NOT NULL DEFAULT 0,
    "segment_count" INTEGER NOT NULL DEFAULT 1,
    "vector_id" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "info_units_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "info_units_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "info_units_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "info_units_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE infra_endpoint_routes (
    "endpoint_id" TEXT NOT NULL,
    "path_prefix" TEXT,
    "methods_json" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("endpoint_id", "position"),
    CONSTRAINT "infra_endpoint_routes_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "infra_endpoints" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE infra_endpoints (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'http',
    "target_worker_name" TEXT NOT NULL,
    "timeout_ms" INTEGER,
    "bundle_deployment_id" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "infra_endpoints_bundle_deployment_id_fkey" FOREIGN KEY ("bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "infra_endpoints_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE infra_workers (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "runtime" TEXT NOT NULL DEFAULT 'takos.worker',
    "cf_worker_name" TEXT,
    "bundle_deployment_id" TEXT,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "infra_workers_bundle_deployment_id_fkey" FOREIGN KEY ("bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "infra_workers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE lg_checkpoints (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "parent_checkpoint_id" TEXT,
    "ts" DATETIME NOT NULL,
    "checkpoint_type" TEXT NOT NULL,
    "checkpoint_data" TEXT NOT NULL,
    "metadata_type" TEXT,
    "metadata_data" TEXT,
    "session_id" TEXT,
    "snapshot_id" TEXT,

    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id")
);

-- CreateTable
CREATE TABLE lg_writes (
    "thread_id" TEXT NOT NULL,
    "checkpoint_ns" TEXT NOT NULL DEFAULT '',
    "checkpoint_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "value_type" TEXT NOT NULL,
    "value_data" TEXT NOT NULL,

    PRIMARY KEY ("thread_id", "checkpoint_ns", "checkpoint_id", "task_id", "channel")
);

-- CreateTable
CREATE TABLE managed_takos_tokens (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "env_name" TEXT NOT NULL,
    "subject_account_id" TEXT NOT NULL,
    "subject_mode" TEXT NOT NULL,
    "scopes_json" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "managed_takos_tokens_subject_account_id_fkey" FOREIGN KEY ("subject_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "managed_takos_tokens_worker_id_account_id_fkey" FOREIGN KEY ("worker_id", "account_id") REFERENCES "workers" ("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "managed_takos_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE mcp_oauth_pending (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "server_name" TEXT NOT NULL,
    "server_url" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "code_verifier" TEXT NOT NULL,
    "issuer_url" TEXT NOT NULL,
    "token_endpoint" TEXT NOT NULL,
    "scope" TEXT,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_pending_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE mcp_servers (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'streamable-http',
    "source_type" TEXT NOT NULL DEFAULT 'external',
    "auth_mode" TEXT NOT NULL DEFAULT 'oauth_pkce',
    "worker_id" TEXT,
    "bundle_deployment_id" TEXT,
    "oauth_access_token" TEXT,
    "oauth_refresh_token" TEXT,
    "oauth_token_expires_at" DATETIME,
    "oauth_scope" TEXT,
    "oauth_issuer_url" TEXT,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_servers_bundle_deployment_id_fkey" FOREIGN KEY ("bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "mcp_servers_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "mcp_servers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE memories (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "author_account_id" TEXT,
    "thread_id" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "importance" REAL DEFAULT 0.5,
    "tags" TEXT,
    "occurred_at" DATETIME,
    "expires_at" DATETIME,
    "last_accessed_at" DATETIME,
    "access_count" INTEGER DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memories_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "memories_author_account_id_fkey" FOREIGN KEY ("author_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "memories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE messages (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "r2_key" TEXT,
    "tool_calls" TEXT,
    "tool_call_id" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE moderation_audit_logs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actor_account_id" TEXT,
    "report_id" TEXT,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_label" TEXT,
    "action_type" TEXT NOT NULL,
    "reason" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "moderation_audit_logs_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "moderation_audit_logs_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE nodes (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "label" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "nodes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE notification_preferences (
    "account_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("account_id", "type", "channel"),
    CONSTRAINT "notification_preferences_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE notification_settings (
    "account_id" TEXT NOT NULL PRIMARY KEY,
    "muted_until" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE notifications (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipient_account_id" TEXT NOT NULL,
    "account_id" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "read_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email_status" TEXT NOT NULL DEFAULT 'skipped',
    "email_attempts" INTEGER NOT NULL DEFAULT 0,
    "email_sent_at" DATETIME,
    "email_error" TEXT,
    CONSTRAINT "notifications_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "notifications_recipient_account_id_fkey" FOREIGN KEY ("recipient_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE oauth_audit_logs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT,
    "client_id" TEXT,
    "event_type" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_audit_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE oauth_authorization_codes (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
    "used" INTEGER NOT NULL DEFAULT 0,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE oauth_clients (
    "id" TEXT NOT NULL PRIMARY KEY,
    "client_id" TEXT NOT NULL,
    "client_secret_hash" TEXT,
    "client_type" TEXT NOT NULL DEFAULT 'confidential',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_uri" TEXT,
    "client_uri" TEXT,
    "policy_uri" TEXT,
    "tos_uri" TEXT,
    "redirect_uris" TEXT NOT NULL,
    "grant_types" TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
    "response_types" TEXT NOT NULL DEFAULT '["code"]',
    "allowed_scopes" TEXT NOT NULL,
    "owner_account_id" TEXT,
    "registration_access_token_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_clients_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE oauth_consents (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_consents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE oauth_device_codes (
    "id" TEXT NOT NULL PRIMARY KEY,
    "device_code_hash" TEXT NOT NULL,
    "user_code_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "account_id" TEXT,
    "interval_seconds" INTEGER NOT NULL DEFAULT 5,
    "last_polled_at" DATETIME,
    "approved_at" DATETIME,
    "denied_at" DATETIME,
    "used_at" DATETIME,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_device_codes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE oauth_states (
    "id" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL,
    "redirect_uri" TEXT NOT NULL,
    "return_to" TEXT,
    "cli_callback" TEXT,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE oauth_tokens (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token_type" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "refresh_token_id" TEXT,
    "revoked" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" DATETIME,
    "revoked_reason" TEXT,
    "used_at" DATETIME,
    "token_family" TEXT,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_tokens_refresh_token_id_fkey" FOREIGN KEY ("refresh_token_id") REFERENCES "oauth_tokens" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "oauth_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE personal_access_tokens (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '*',
    "expires_at" DATETIME,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "personal_access_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE pr_comments (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pr_id" TEXT NOT NULL,
    "author_type" TEXT NOT NULL DEFAULT 'ai',
    "author_id" TEXT,
    "content" TEXT NOT NULL,
    "file_path" TEXT,
    "line_number" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pr_comments_pr_id_fkey" FOREIGN KEY ("pr_id") REFERENCES "pull_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE pr_reviews (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pr_id" TEXT NOT NULL,
    "reviewer_type" TEXT NOT NULL DEFAULT 'ai',
    "reviewer_id" TEXT,
    "status" TEXT NOT NULL,
    "body" TEXT,
    "analysis" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pr_reviews_pr_id_fkey" FOREIGN KEY ("pr_id") REFERENCES "pull_requests" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE pull_requests (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "head_branch" TEXT NOT NULL,
    "base_branch" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "author_type" TEXT NOT NULL DEFAULT 'agent',
    "author_id" TEXT,
    "run_id" TEXT,
    "merged_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pull_requests_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "pull_requests_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE reminders (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "owner_account_id" TEXT,
    "content" TEXT NOT NULL,
    "context" TEXT,
    "trigger_type" TEXT NOT NULL,
    "trigger_value" TEXT,
    "status" TEXT DEFAULT 'pending',
    "triggered_at" DATETIME,
    "priority" TEXT DEFAULT 'normal',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminders_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "reminders_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE repo_forks (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fork_repo_id" TEXT NOT NULL,
    "upstream_repo_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repo_forks_upstream_repo_id_fkey" FOREIGN KEY ("upstream_repo_id") REFERENCES "repositories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "repo_forks_fork_repo_id_fkey" FOREIGN KEY ("fork_repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE repo_release_assets (
    "id" TEXT NOT NULL PRIMARY KEY,
    "release_id" TEXT NOT NULL,
    "asset_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "checksum_sha256" TEXT,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "bundle_format" TEXT,
    "bundle_meta_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repo_release_assets_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "repo_releases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE repo_releases (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "commit_sha" TEXT,
    "is_prerelease" INTEGER NOT NULL DEFAULT 0,
    "is_draft" INTEGER NOT NULL DEFAULT 0,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "author_account_id" TEXT,
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repo_releases_author_account_id_fkey" FOREIGN KEY ("author_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "repo_releases_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE repo_remotes (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'upstream',
    "upstream_repo_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repo_remotes_upstream_repo_id_fkey" FOREIGN KEY ("upstream_repo_id") REFERENCES "repositories" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "repo_remotes_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE repo_stars (
    "account_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("account_id", "repo_id"),
    CONSTRAINT "repo_stars_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "repo_stars_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE reports (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporter_account_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "target_label" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "evidence" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "auto_flagged" INTEGER NOT NULL DEFAULT 0,
    "internal_notes" TEXT,
    "resolved_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reports_reporter_account_id_fkey" FOREIGN KEY ("reporter_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE repositories (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "forked_from_id" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "forks" INTEGER NOT NULL DEFAULT 0,
    "git_enabled" INTEGER NOT NULL DEFAULT 0,
    "primary_language" TEXT,
    "license" TEXT,
    "featured" INTEGER NOT NULL DEFAULT 0,
    "install_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "repositories_forked_from_id_fkey" FOREIGN KEY ("forked_from_id") REFERENCES "repositories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "repositories_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE resource_access (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resource_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'read',
    "granted_by_account_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_access_granted_by_account_id_fkey" FOREIGN KEY ("granted_by_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "resource_access_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "resource_access_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE resource_access_tokens (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resource_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "permission" TEXT NOT NULL DEFAULT 'read',
    "expires_at" DATETIME,
    "last_used_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resource_access_tokens_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE resources (
    "id" TEXT NOT NULL PRIMARY KEY,
    "owner_account_id" TEXT NOT NULL,
    "account_id" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "cf_id" TEXT,
    "cf_name" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "size_bytes" INTEGER DEFAULT 0,
    "item_count" INTEGER DEFAULT 0,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "resources_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "resources_owner_account_id_fkey" FOREIGN KEY ("owner_account_id") REFERENCES "accounts" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE run_events (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "run_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "run_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE runs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "session_id" TEXT,
    "parent_run_id" TEXT,
    "agent_type" TEXT NOT NULL DEFAULT 'default',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "last_event_id" INTEGER NOT NULL DEFAULT 0,
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT,
    "error" TEXT,
    "usage" TEXT NOT NULL DEFAULT '{}',
    "worker_id" TEXT,
    "worker_heartbeat" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "runs_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "runs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runs_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE service_tokens (
    "id" TEXT NOT NULL PRIMARY KEY,
    "service_name" TEXT,
    "token_hash" TEXT NOT NULL,
    "permissions" TEXT,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_id" TEXT,
    CONSTRAINT "service_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE session_files (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "operation" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_files_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE session_repos (
    "id" TEXT NOT NULL PRIMARY KEY,
    "session_id" TEXT NOT NULL,
    "repo_id" TEXT NOT NULL,
    "branch" TEXT,
    "mount_path" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "session_repos_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "session_repos_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE sessions (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "user_account_id" TEXT,
    "base_snapshot_id" TEXT NOT NULL,
    "head_snapshot_id" TEXT,
    "status" TEXT NOT NULL,
    "last_heartbeat" DATETIME,
    "repo_id" TEXT,
    "branch" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sessions_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "sessions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE shortcut_group_items (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "worker_id" TEXT,
    "ui_path" TEXT,
    "resource_id" TEXT,
    "url" TEXT,
    CONSTRAINT "shortcut_group_items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "shortcut_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE shortcut_groups (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "bundle_deployment_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shortcut_groups_bundle_deployment_id_fkey" FOREIGN KEY ("bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "shortcut_groups_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE shortcuts (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_account_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shortcuts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shortcuts_user_account_id_fkey" FOREIGN KEY ("user_account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE skills (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT NOT NULL,
    "triggers" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "skills_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE snapshots (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "parent_ids" TEXT,
    "tree_key" TEXT NOT NULL,
    "message" TEXT,
    "author" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "snapshots_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE tags (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "message" TEXT,
    "tagger_name" TEXT,
    "tagger_email" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tags_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE thread_shares (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_by_account_id" TEXT,
    "token" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'public',
    "password_hash" TEXT,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "last_accessed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "thread_shares_created_by_account_id_fkey" FOREIGN KEY ("created_by_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "thread_shares_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "thread_shares_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE threads (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "title" TEXT,
    "locale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "key_points" TEXT NOT NULL DEFAULT '[]',
    "retrieval_index" INTEGER NOT NULL DEFAULT -1,
    "context_window" INTEGER NOT NULL DEFAULT 50,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "threads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE ui_extensions (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT,
    "bundle_r2_key" TEXT NOT NULL,
    "sidebar_json" TEXT,
    "bundle_deployment_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ui_extensions_bundle_deployment_id_fkey" FOREIGN KEY ("bundle_deployment_id") REFERENCES "bundle_deployments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ui_extensions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE usage_events (
    "id" TEXT NOT NULL PRIMARY KEY,
    "idempotency_key" TEXT,
    "billing_account_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL DEFAULT 'space',
    "account_id" TEXT,
    "meter_type" TEXT NOT NULL,
    "units" REAL NOT NULL,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "reference_id" TEXT,
    "reference_type" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "usage_events_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE usage_rollups (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billing_account_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "account_id" TEXT,
    "meter_type" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "units" REAL NOT NULL DEFAULT 0,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_rollups_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "usage_rollups_billing_account_id_fkey" FOREIGN KEY ("billing_account_id") REFERENCES "billing_accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE worker_bindings (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "binding_name" TEXT NOT NULL,
    "binding_type" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "worker_bindings_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "worker_bindings_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE worker_common_env_links (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "worker_id" TEXT NOT NULL,
    "env_name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "last_applied_fingerprint" TEXT,
    "sync_state" TEXT NOT NULL DEFAULT 'pending',
    "sync_reason" TEXT,
    "last_observed_fingerprint" TEXT,
    "last_reconciled_at" DATETIME,
    "last_sync_error" TEXT,
    "state_updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "worker_common_env_links_worker_id_account_id_fkey" FOREIGN KEY ("worker_id", "account_id") REFERENCES "workers" ("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "worker_common_env_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE worker_env_vars (
    "id" TEXT NOT NULL PRIMARY KEY,
    "worker_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value_encrypted" TEXT NOT NULL,
    "is_secret" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "worker_env_vars_worker_id_account_id_fkey" FOREIGN KEY ("worker_id", "account_id") REFERENCES "workers" ("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE worker_mcp_endpoints (
    "worker_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "enabled" INTEGER NOT NULL DEFAULT 1,

    PRIMARY KEY ("worker_id", "name"),
    CONSTRAINT "worker_mcp_endpoints_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "worker_runtime_settings" ("worker_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE worker_runtime_flags (
    "worker_id" TEXT NOT NULL,
    "flag" TEXT NOT NULL,

    PRIMARY KEY ("worker_id", "flag"),
    CONSTRAINT "worker_runtime_flags_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "worker_runtime_settings" ("worker_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE worker_runtime_limits (
    "worker_id" TEXT NOT NULL PRIMARY KEY,
    "cpu_ms" INTEGER,
    "memory_mb" INTEGER,
    "subrequest_limit" INTEGER,
    CONSTRAINT "worker_runtime_limits_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "worker_runtime_settings" ("worker_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE worker_runtime_settings (
    "worker_id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "compatibility_date" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "worker_runtime_settings_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "worker_runtime_settings_worker_id_fkey" FOREIGN KEY ("worker_id") REFERENCES "workers" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE workers (
    "id" TEXT NOT NULL PRIMARY KEY,
    "account_id" TEXT NOT NULL,
    "worker_type" TEXT NOT NULL DEFAULT 'app',
    "name_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "config" TEXT,
    "hostname" TEXT,
    "worker_name" TEXT,
    "slug" TEXT,
    "current_deployment_id" TEXT,
    "previous_deployment_id" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workers_current_deployment_id_fkey" FOREIGN KEY ("current_deployment_id") REFERENCES "deployments" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE workflow_artifacts (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "r2_key" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "mime_type" TEXT,
    "expires_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_artifacts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE workflow_jobs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "run_id" TEXT NOT NULL,
    "job_key" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "conclusion" TEXT,
    "runner_id" TEXT,
    "runner_name" TEXT,
    "queued_at" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "logs_url" TEXT,
    "logs_r2_key" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_jobs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "workflow_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE workflow_runs (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "workflow_path" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "ref" TEXT,
    "sha" TEXT,
    "actor_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "conclusion" TEXT,
    "queued_at" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "inputs" TEXT,
    "run_number" INTEGER,
    "run_attempt" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_runs_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "workflow_runs_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE workflow_secrets (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME,
    CONSTRAINT "workflow_secrets_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE workflow_steps (
    "id" TEXT NOT NULL PRIMARY KEY,
    "job_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "conclusion" TEXT,
    "run_command" TEXT,
    "uses_action" TEXT,
    "exit_code" INTEGER,
    "error_message" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "workflow_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "workflow_jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE workflows (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repo_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT,
    "content" TEXT NOT NULL,
    "triggers" TEXT,
    "parsed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME,
    CONSTRAINT "workflows_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "account_blocks_blocker_account_id_idx" ON "account_blocks"("blocker_account_id");

-- CreateIndex
CREATE INDEX "account_blocks_blocked_account_id_idx" ON "account_blocks"("blocked_account_id");

-- CreateIndex
CREATE INDEX "account_env_vars_account_id_idx" ON "account_env_vars"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_env_vars_account_id_name_key" ON "account_env_vars"("account_id", "name");

-- CreateIndex
CREATE INDEX "account_follow_requests_target_account_id_status_idx" ON "account_follow_requests"("target_account_id", "status");

-- CreateIndex
CREATE INDEX "account_follow_requests_requester_account_id_idx" ON "account_follow_requests"("requester_account_id");

-- CreateIndex
CREATE INDEX "account_follow_requests_created_at_idx" ON "account_follow_requests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "account_follow_requests_requester_account_id_target_account_id_key" ON "account_follow_requests"("requester_account_id", "target_account_id");

-- CreateIndex
CREATE INDEX "account_follows_following_account_id_idx" ON "account_follows"("following_account_id");

-- CreateIndex
CREATE INDEX "account_follows_follower_account_id_idx" ON "account_follows"("follower_account_id");

-- CreateIndex
CREATE INDEX "account_memberships_member_id_idx" ON "account_memberships"("member_id");

-- CreateIndex
CREATE INDEX "account_memberships_account_id_idx" ON "account_memberships"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_memberships_account_id_member_id_key" ON "account_memberships"("account_id", "member_id");

-- CreateIndex
CREATE INDEX "account_metadata_key_idx" ON "account_metadata"("key");

-- CreateIndex
CREATE INDEX "account_moderation_suspended_until_idx" ON "account_moderation"("suspended_until");

-- CreateIndex
CREATE INDEX "account_moderation_status_idx" ON "account_moderation"("status");

-- CreateIndex
CREATE INDEX "account_mutes_muter_account_id_idx" ON "account_mutes"("muter_account_id");

-- CreateIndex
CREATE INDEX "account_mutes_muted_account_id_idx" ON "account_mutes"("muted_account_id");

-- CreateIndex
CREATE INDEX "account_stats_total_size_bytes_idx" ON "account_stats"("total_size_bytes");

-- CreateIndex
CREATE INDEX "account_stats_file_count_idx" ON "account_stats"("file_count");

-- CreateIndex
CREATE INDEX "account_storage_files_path_idx" ON "account_storage_files"("path");

-- CreateIndex
CREATE INDEX "account_storage_files_parent_id_idx" ON "account_storage_files"("parent_id");

-- CreateIndex
CREATE INDEX "account_storage_files_account_id_type_idx" ON "account_storage_files"("account_id", "type");

-- CreateIndex
CREATE INDEX "account_storage_files_account_id_parent_id_type_idx" ON "account_storage_files"("account_id", "parent_id", "type");

-- CreateIndex
CREATE INDEX "account_storage_files_account_id_idx" ON "account_storage_files"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_storage_files_account_id_path_key" ON "account_storage_files"("account_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_slug_key" ON "accounts"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_google_sub_key" ON "accounts"("google_sub");

-- CreateIndex
CREATE INDEX "accounts_type_idx" ON "accounts"("type");

-- CreateIndex
CREATE INDEX "accounts_takos_auth_id_idx" ON "accounts"("takos_auth_id");

-- CreateIndex
CREATE INDEX "accounts_slug_idx" ON "accounts"("slug");

-- CreateIndex
CREATE INDEX "accounts_owner_account_id_idx" ON "accounts"("owner_account_id");

-- CreateIndex
CREATE INDEX "accounts_google_sub_idx" ON "accounts"("google_sub");

-- CreateIndex
CREATE INDEX "accounts_email_idx" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "accounts_default_repository_id_idx" ON "accounts"("default_repository_id");

-- CreateIndex
CREATE INDEX "agent_tasks_thread_id_idx" ON "agent_tasks"("thread_id");

-- CreateIndex
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks"("status");

-- CreateIndex
CREATE INDEX "agent_tasks_priority_idx" ON "agent_tasks"("priority");

-- CreateIndex
CREATE INDEX "agent_tasks_last_run_id_idx" ON "agent_tasks"("last_run_id");

-- CreateIndex
CREATE INDEX "agent_tasks_created_by_account_id_idx" ON "agent_tasks"("created_by_account_id");

-- CreateIndex
CREATE INDEX "agent_tasks_account_id_status_idx" ON "agent_tasks"("account_id", "status");

-- CreateIndex
CREATE INDEX "agent_tasks_account_id_idx" ON "agent_tasks"("account_id");

-- CreateIndex
CREATE INDEX "agent_tasks_account_id_created_at_idx" ON "agent_tasks"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "apps_worker_id_idx" ON "apps"("worker_id");

-- CreateIndex
CREATE INDEX "apps_app_type_idx" ON "apps"("app_type");

-- CreateIndex
CREATE INDEX "apps_account_id_idx" ON "apps"("account_id");

-- CreateIndex
CREATE INDEX "artifacts_type_idx" ON "artifacts"("type");

-- CreateIndex
CREATE INDEX "artifacts_run_id_idx" ON "artifacts"("run_id");

-- CreateIndex
CREATE INDEX "artifacts_file_id_idx" ON "artifacts"("file_id");

-- CreateIndex
CREATE INDEX "artifacts_account_id_idx" ON "artifacts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_services_domain_key" ON "auth_services"("domain");

-- CreateIndex
CREATE INDEX "auth_services_domain_idx" ON "auth_services"("domain");

-- CreateIndex
CREATE INDEX "auth_services_api_key_hash_idx" ON "auth_services"("api_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_token_hash_idx" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "auth_sessions_account_id_idx" ON "auth_sessions"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_accounts_account_id_key" ON "billing_accounts"("account_id");

-- CreateIndex
CREATE INDEX "billing_accounts_stripe_customer_id_idx" ON "billing_accounts"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "billing_accounts_status_idx" ON "billing_accounts"("status");

-- CreateIndex
CREATE INDEX "billing_accounts_plan_id_idx" ON "billing_accounts"("plan_id");

-- CreateIndex
CREATE INDEX "billing_accounts_account_id_idx" ON "billing_accounts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_name_key" ON "billing_plans"("name");

-- CreateIndex
CREATE INDEX "billing_plans_name_idx" ON "billing_plans"("name");

-- CreateIndex
CREATE INDEX "billing_plans_is_default_idx" ON "billing_plans"("is_default");

-- CreateIndex
CREATE INDEX "billing_transactions_type_idx" ON "billing_transactions"("type");

-- CreateIndex
CREATE INDEX "billing_transactions_reference_id_idx" ON "billing_transactions"("reference_id");

-- CreateIndex
CREATE INDEX "billing_transactions_created_at_idx" ON "billing_transactions"("created_at");

-- CreateIndex
CREATE INDEX "billing_transactions_billing_account_id_idx" ON "billing_transactions"("billing_account_id");

-- CreateIndex
CREATE INDEX "blobs_refcount_idx" ON "blobs"("refcount");

-- CreateIndex
CREATE INDEX "branches_repo_id_idx" ON "branches"("repo_id");

-- CreateIndex
CREATE INDEX "branches_commit_sha_idx" ON "branches"("commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "branches_repo_id_name_key" ON "branches"("repo_id", "name");

-- CreateIndex
CREATE INDEX "bundle_deployment_events_source_repo_id_idx" ON "bundle_deployment_events"("source_repo_id");

-- CreateIndex
CREATE INDEX "bundle_deployment_events_bundle_key_idx" ON "bundle_deployment_events"("bundle_key");

-- CreateIndex
CREATE INDEX "bundle_deployment_events_bundle_deployment_id_idx" ON "bundle_deployment_events"("bundle_deployment_id");

-- CreateIndex
CREATE INDEX "bundle_deployment_events_account_id_name_deployed_at_idx" ON "bundle_deployment_events"("account_id", "name", "deployed_at");

-- CreateIndex
CREATE INDEX "bundle_deployment_events_account_id_idx" ON "bundle_deployment_events"("account_id");

-- CreateIndex
CREATE INDEX "bundle_deployments_source_repo_id_idx" ON "bundle_deployments"("source_repo_id");

-- CreateIndex
CREATE INDEX "bundle_deployments_bundle_key_idx" ON "bundle_deployments"("bundle_key");

-- CreateIndex
CREATE INDEX "bundle_deployments_account_id_idx" ON "bundle_deployments"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_deployments_account_id_name_key" ON "bundle_deployments"("account_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_deployments_account_id_app_id_key" ON "bundle_deployments"("account_id", "app_id");

-- CreateIndex
CREATE INDEX "chunks_vector_id_idx" ON "chunks"("vector_id");

-- CreateIndex
CREATE INDEX "chunks_file_id_idx" ON "chunks"("file_id");

-- CreateIndex
CREATE INDEX "chunks_account_id_idx" ON "chunks"("account_id");

-- CreateIndex
CREATE INDEX "commits_tree_sha_idx" ON "commits"("tree_sha");

-- CreateIndex
CREATE INDEX "commits_sha_idx" ON "commits"("sha");

-- CreateIndex
CREATE INDEX "commits_repo_id_idx" ON "commits"("repo_id");

-- CreateIndex
CREATE INDEX "commits_repo_id_commit_date_idx" ON "commits"("repo_id", "commit_date");

-- CreateIndex
CREATE UNIQUE INDEX "commits_repo_id_sha_key" ON "commits"("repo_id", "sha");

-- CreateIndex
CREATE INDEX "common_env_audit_logs_worker_id_created_at_idx" ON "common_env_audit_logs"("worker_id", "created_at");

-- CreateIndex
CREATE INDEX "common_env_audit_logs_account_id_env_name_created_at_idx" ON "common_env_audit_logs"("account_id", "env_name", "created_at");

-- CreateIndex
CREATE INDEX "common_env_audit_logs_account_id_created_at_idx" ON "common_env_audit_logs"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "common_env_reconcile_jobs_status_next_attempt_at_idx" ON "common_env_reconcile_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "common_env_reconcile_jobs_account_id_worker_id_status_idx" ON "common_env_reconcile_jobs"("account_id", "worker_id", "status");

-- CreateIndex
CREATE INDEX "common_env_reconcile_jobs_account_id_status_idx" ON "common_env_reconcile_jobs"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "custom_domains_domain_key" ON "custom_domains"("domain");

-- CreateIndex
CREATE INDEX "custom_domains_worker_id_idx" ON "custom_domains"("worker_id");

-- CreateIndex
CREATE INDEX "custom_domains_status_idx" ON "custom_domains"("status");

-- CreateIndex
CREATE INDEX "custom_domains_domain_idx" ON "custom_domains"("domain");

-- CreateIndex
CREATE INDEX "deployment_events_event_type_idx" ON "deployment_events"("event_type");

-- CreateIndex
CREATE INDEX "deployment_events_deployment_id_idx" ON "deployment_events"("deployment_id");

-- CreateIndex
CREATE INDEX "deployment_events_actor_account_id_idx" ON "deployment_events"("actor_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_idempotency_key_key" ON "deployments"("idempotency_key");

-- CreateIndex
CREATE INDEX "deployments_worker_id_routing_status_idx" ON "deployments"("worker_id", "routing_status");

-- CreateIndex
CREATE INDEX "deployments_worker_id_idx" ON "deployments"("worker_id");

-- CreateIndex
CREATE INDEX "deployments_worker_id_created_at_idx" ON "deployments"("worker_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- CreateIndex
CREATE INDEX "deployments_account_id_status_idx" ON "deployments"("account_id", "status");

-- CreateIndex
CREATE INDEX "deployments_account_id_idx" ON "deployments"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "deployments_worker_id_version_key" ON "deployments"("worker_id", "version");

-- CreateIndex
CREATE INDEX "edges_type_idx" ON "edges"("type");

-- CreateIndex
CREATE INDEX "edges_target_id_idx" ON "edges"("target_id");

-- CreateIndex
CREATE INDEX "edges_source_id_idx" ON "edges"("source_id");

-- CreateIndex
CREATE INDEX "edges_account_id_idx" ON "edges"("account_id");

-- CreateIndex
CREATE INDEX "file_handlers_account_id_idx" ON "file_handlers"("account_id");

-- CreateIndex
CREATE INDEX "files_sha256_idx" ON "files"("sha256");

-- CreateIndex
CREATE INDEX "files_origin_idx" ON "files"("origin");

-- CreateIndex
CREATE INDEX "files_kind_idx" ON "files"("kind");

-- CreateIndex
CREATE INDEX "files_account_id_idx" ON "files"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_account_id_path_key" ON "files"("account_id", "path");

-- CreateIndex
CREATE INDEX "git_commits_parent_id_idx" ON "git_commits"("parent_id");

-- CreateIndex
CREATE INDEX "git_commits_created_at_idx" ON "git_commits"("created_at" DESC);

-- CreateIndex
CREATE INDEX "git_commits_author_account_id_idx" ON "git_commits"("author_account_id");

-- CreateIndex
CREATE INDEX "git_commits_account_id_idx" ON "git_commits"("account_id");

-- CreateIndex
CREATE INDEX "git_file_changes_path_idx" ON "git_file_changes"("path");

-- CreateIndex
CREATE INDEX "git_file_changes_file_id_idx" ON "git_file_changes"("file_id");

-- CreateIndex
CREATE INDEX "git_file_changes_commit_id_idx" ON "git_file_changes"("commit_id");

-- CreateIndex
CREATE INDEX "index_jobs_status_idx" ON "index_jobs"("status");

-- CreateIndex
CREATE INDEX "index_jobs_account_id_idx" ON "index_jobs"("account_id");

-- CreateIndex
CREATE INDEX "info_units_thread_id_idx" ON "info_units"("thread_id");

-- CreateIndex
CREATE INDEX "info_units_session_id_idx" ON "info_units"("session_id");

-- CreateIndex
CREATE INDEX "info_units_run_id_idx" ON "info_units"("run_id");

-- CreateIndex
CREATE INDEX "info_units_kind_idx" ON "info_units"("kind");

-- CreateIndex
CREATE INDEX "info_units_account_id_idx" ON "info_units"("account_id");

-- CreateIndex
CREATE INDEX "infra_endpoints_bundle_deployment_id_idx" ON "infra_endpoints"("bundle_deployment_id");

-- CreateIndex
CREATE INDEX "infra_endpoints_account_id_idx" ON "infra_endpoints"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "infra_endpoints_account_id_name_key" ON "infra_endpoints"("account_id", "name");

-- CreateIndex
CREATE INDEX "infra_workers_bundle_deployment_id_idx" ON "infra_workers"("bundle_deployment_id");

-- CreateIndex
CREATE INDEX "infra_workers_account_id_idx" ON "infra_workers"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "infra_workers_account_id_name_key" ON "infra_workers"("account_id", "name");

-- CreateIndex
CREATE INDEX "lg_checkpoints_ts_idx" ON "lg_checkpoints"("ts");

-- CreateIndex
CREATE INDEX "lg_checkpoints_thread_id_checkpoint_ns_idx" ON "lg_checkpoints"("thread_id", "checkpoint_ns");

-- CreateIndex
CREATE INDEX "lg_writes_thread_id_checkpoint_ns_checkpoint_id_idx" ON "lg_writes"("thread_id", "checkpoint_ns", "checkpoint_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_auth_identities_provider_sub" ON "auth_identities"("provider", "provider_sub");

-- CreateIndex
CREATE INDEX "idx_auth_identities_user_id" ON "auth_identities"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "managed_takos_tokens_token_hash_key" ON "managed_takos_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "managed_takos_tokens_worker_id_idx" ON "managed_takos_tokens"("worker_id");

-- CreateIndex
CREATE INDEX "managed_takos_tokens_subject_account_id_idx" ON "managed_takos_tokens"("subject_account_id");

-- CreateIndex
CREATE INDEX "managed_takos_tokens_account_id_env_name_idx" ON "managed_takos_tokens"("account_id", "env_name");

-- CreateIndex
CREATE UNIQUE INDEX "managed_takos_tokens_worker_id_env_name_key" ON "managed_takos_tokens"("worker_id", "env_name");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_oauth_pending_state_key" ON "mcp_oauth_pending"("state");

-- CreateIndex
CREATE INDEX "mcp_oauth_pending_state_idx" ON "mcp_oauth_pending"("state");

-- CreateIndex
CREATE INDEX "mcp_oauth_pending_account_id_idx" ON "mcp_oauth_pending"("account_id");

-- CreateIndex
CREATE INDEX "mcp_servers_worker_id_idx" ON "mcp_servers"("worker_id");

-- CreateIndex
CREATE INDEX "mcp_servers_bundle_deployment_id_idx" ON "mcp_servers"("bundle_deployment_id");

-- CreateIndex
CREATE INDEX "mcp_servers_account_id_idx" ON "mcp_servers"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_account_id_name_key" ON "mcp_servers"("account_id", "name");

-- CreateIndex
CREATE INDEX "memories_type_idx" ON "memories"("type");

-- CreateIndex
CREATE INDEX "memories_type_category_idx" ON "memories"("type", "category");

-- CreateIndex
CREATE INDEX "memories_thread_id_idx" ON "memories"("thread_id");

-- CreateIndex
CREATE INDEX "memories_importance_idx" ON "memories"("importance" DESC);

-- CreateIndex
CREATE INDEX "memories_author_account_id_idx" ON "memories"("author_account_id");

-- CreateIndex
CREATE INDEX "memories_account_id_idx" ON "memories"("account_id");

-- CreateIndex
CREATE INDEX "messages_thread_id_sequence_idx" ON "messages"("thread_id", "sequence");

-- CreateIndex
CREATE INDEX "messages_thread_id_idx" ON "messages"("thread_id");

-- CreateIndex
CREATE INDEX "messages_thread_id_created_at_idx" ON "messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "moderation_audit_logs_target_type_target_id_idx" ON "moderation_audit_logs"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "moderation_audit_logs_report_id_idx" ON "moderation_audit_logs"("report_id");

-- CreateIndex
CREATE INDEX "moderation_audit_logs_created_at_idx" ON "moderation_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "moderation_audit_logs_actor_account_id_idx" ON "moderation_audit_logs"("actor_account_id");

-- CreateIndex
CREATE INDEX "moderation_audit_logs_action_type_idx" ON "moderation_audit_logs"("action_type");

-- CreateIndex
CREATE INDEX "nodes_type_idx" ON "nodes"("type");

-- CreateIndex
CREATE INDEX "nodes_ref_id_idx" ON "nodes"("ref_id");

-- CreateIndex
CREATE INDEX "nodes_account_id_idx" ON "nodes"("account_id");

-- CreateIndex
CREATE INDEX "notification_preferences_type_idx" ON "notification_preferences"("type");

-- CreateIndex
CREATE INDEX "notification_preferences_channel_idx" ON "notification_preferences"("channel");

-- CreateIndex
CREATE INDEX "notification_preferences_account_id_idx" ON "notification_preferences"("account_id");

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_recipient_account_id_read_at_idx" ON "notifications"("recipient_account_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_account_id_idx" ON "notifications"("recipient_account_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_account_id_created_at_idx" ON "notifications"("recipient_account_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_account_id_idx" ON "notifications"("account_id");

-- CreateIndex
CREATE INDEX "oauth_audit_logs_event_type_idx" ON "oauth_audit_logs"("event_type");

-- CreateIndex
CREATE INDEX "oauth_audit_logs_created_at_idx" ON "oauth_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "oauth_audit_logs_client_id_idx" ON "oauth_audit_logs"("client_id");

-- CreateIndex
CREATE INDEX "oauth_audit_logs_account_id_idx" ON "oauth_audit_logs"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_authorization_codes_code_hash_key" ON "oauth_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_expires_at_idx" ON "oauth_authorization_codes"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_code_hash_idx" ON "oauth_authorization_codes"("code_hash");

-- CreateIndex
CREATE INDEX "oauth_authorization_codes_client_id_idx" ON "oauth_authorization_codes"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_client_id_key" ON "oauth_clients"("client_id");

-- CreateIndex
CREATE INDEX "oauth_clients_status_idx" ON "oauth_clients"("status");

-- CreateIndex
CREATE INDEX "oauth_clients_owner_account_id_idx" ON "oauth_clients"("owner_account_id");

-- CreateIndex
CREATE INDEX "oauth_clients_client_id_idx" ON "oauth_clients"("client_id");

-- CreateIndex
CREATE INDEX "oauth_consents_client_id_idx" ON "oauth_consents"("client_id");

-- CreateIndex
CREATE INDEX "oauth_consents_account_id_idx" ON "oauth_consents"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_consents_account_id_client_id_key" ON "oauth_consents"("account_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_device_codes_device_code_hash_key" ON "oauth_device_codes"("device_code_hash");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_device_codes_user_code_hash_key" ON "oauth_device_codes"("user_code_hash");

-- CreateIndex
CREATE INDEX "oauth_device_codes_user_code_hash_idx" ON "oauth_device_codes"("user_code_hash");

-- CreateIndex
CREATE INDEX "oauth_device_codes_status_idx" ON "oauth_device_codes"("status");

-- CreateIndex
CREATE INDEX "oauth_device_codes_expires_at_idx" ON "oauth_device_codes"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_device_codes_device_code_hash_idx" ON "oauth_device_codes"("device_code_hash");

-- CreateIndex
CREATE INDEX "oauth_device_codes_client_id_idx" ON "oauth_device_codes"("client_id");

-- CreateIndex
CREATE INDEX "oauth_device_codes_account_id_idx" ON "oauth_device_codes"("account_id");

CREATE UNIQUE INDEX "oauth_states_state_key" ON "oauth_states"("state");

-- CreateIndex
CREATE INDEX "oauth_states_state_idx" ON "oauth_states"("state");

-- CreateIndex
CREATE INDEX "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_token_hash_key" ON "oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_token_type_idx" ON "oauth_tokens"("token_type");

-- CreateIndex
CREATE INDEX "oauth_tokens_token_hash_idx" ON "oauth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "oauth_tokens_token_family_idx" ON "oauth_tokens"("token_family");

-- CreateIndex
CREATE INDEX "oauth_tokens_revoked_idx" ON "oauth_tokens"("revoked");

-- CreateIndex
CREATE INDEX "oauth_tokens_expires_at_idx" ON "oauth_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_tokens_client_id_idx" ON "oauth_tokens"("client_id");

-- CreateIndex
CREATE INDEX "oauth_tokens_account_id_revoked_idx" ON "oauth_tokens"("account_id", "revoked");

-- CreateIndex
CREATE INDEX "oauth_tokens_account_id_idx" ON "oauth_tokens"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_token_hash_key" ON "personal_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "personal_access_tokens_token_hash_idx" ON "personal_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "personal_access_tokens_account_id_idx" ON "personal_access_tokens"("account_id");

-- CreateIndex
CREATE INDEX "pr_comments_pr_id_idx" ON "pr_comments"("pr_id");

-- CreateIndex
CREATE INDEX "pr_comments_file_path_idx" ON "pr_comments"("file_path");

-- CreateIndex
CREATE INDEX "pr_comments_author_type_author_id_idx" ON "pr_comments"("author_type", "author_id");

-- CreateIndex
CREATE INDEX "pr_reviews_status_idx" ON "pr_reviews"("status");

-- CreateIndex
CREATE INDEX "pr_reviews_reviewer_type_reviewer_id_idx" ON "pr_reviews"("reviewer_type", "reviewer_id");

-- CreateIndex
CREATE INDEX "pr_reviews_pr_id_idx" ON "pr_reviews"("pr_id");

-- CreateIndex
CREATE INDEX "pull_requests_status_idx" ON "pull_requests"("status");

-- CreateIndex
CREATE INDEX "pull_requests_run_id_idx" ON "pull_requests"("run_id");

-- CreateIndex
CREATE INDEX "pull_requests_repo_id_idx" ON "pull_requests"("repo_id");

-- CreateIndex
CREATE INDEX "pull_requests_author_type_author_id_idx" ON "pull_requests"("author_type", "author_id");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repo_id_number_key" ON "pull_requests"("repo_id", "number");

-- CreateIndex
CREATE INDEX "reminders_status_idx" ON "reminders"("status");

-- CreateIndex
CREATE INDEX "reminders_priority_idx" ON "reminders"("priority");

-- CreateIndex
CREATE INDEX "reminders_account_id_idx" ON "reminders"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_forks_fork_repo_id_key" ON "repo_forks"("fork_repo_id");

-- CreateIndex
CREATE INDEX "repo_forks_upstream_repo_id_idx" ON "repo_forks"("upstream_repo_id");

-- CreateIndex
CREATE INDEX "repo_forks_fork_repo_id_idx" ON "repo_forks"("fork_repo_id");

-- CreateIndex
CREATE INDEX "repo_release_assets_release_id_idx" ON "repo_release_assets"("release_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_release_assets_release_id_asset_key_key" ON "repo_release_assets"("release_id", "asset_key");

-- CreateIndex
CREATE INDEX "repo_releases_tag_idx" ON "repo_releases"("tag");

-- CreateIndex
CREATE INDEX "repo_releases_repo_id_idx" ON "repo_releases"("repo_id");

-- CreateIndex
CREATE INDEX "repo_releases_published_at_idx" ON "repo_releases"("published_at");

-- CreateIndex
CREATE UNIQUE INDEX "repo_releases_repo_id_tag_key" ON "repo_releases"("repo_id", "tag");

-- CreateIndex
CREATE INDEX "repo_remotes_repo_id_idx" ON "repo_remotes"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_remotes_repo_id_name_key" ON "repo_remotes"("repo_id", "name");

-- CreateIndex
CREATE INDEX "repo_stars_repo_id_idx" ON "repo_stars"("repo_id");

-- CreateIndex
CREATE INDEX "repo_stars_account_id_idx" ON "repo_stars"("account_id");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "reports_reporter_account_id_idx" ON "reports"("reporter_account_id");

-- CreateIndex
CREATE INDEX "reports_created_at_idx" ON "reports"("created_at");

-- CreateIndex
CREATE INDEX "reports_category_idx" ON "reports"("category");

-- CreateIndex
CREATE INDEX "reports_auto_flagged_idx" ON "reports"("auto_flagged");

-- CreateIndex
CREATE INDEX "repositories_visibility_updated_at_idx" ON "repositories"("visibility", "updated_at");

-- CreateIndex
CREATE INDEX "repositories_visibility_idx" ON "repositories"("visibility");

-- CreateIndex
CREATE INDEX "repositories_primary_language_idx" ON "repositories"("primary_language");

-- CreateIndex
CREATE INDEX "repositories_license_idx" ON "repositories"("license");

-- CreateIndex
CREATE INDEX "repositories_forked_from_id_idx" ON "repositories"("forked_from_id");

-- CreateIndex
CREATE INDEX "repositories_featured_idx" ON "repositories"("featured");

-- CreateIndex
CREATE INDEX "repositories_account_id_visibility_idx" ON "repositories"("account_id", "visibility");

-- CreateIndex
CREATE INDEX "repositories_account_id_idx" ON "repositories"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_account_id_name_key" ON "repositories"("account_id", "name");

-- CreateIndex
CREATE INDEX "resource_access_resource_id_idx" ON "resource_access"("resource_id");

-- CreateIndex
CREATE INDEX "resource_access_account_id_idx" ON "resource_access"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_access_resource_id_account_id_key" ON "resource_access"("resource_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "resource_access_tokens_token_hash_key" ON "resource_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "resource_access_tokens_token_hash_idx" ON "resource_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "resource_access_tokens_resource_id_idx" ON "resource_access_tokens"("resource_id");

-- CreateIndex
CREATE INDEX "resources_type_idx" ON "resources"("type");

-- CreateIndex
CREATE INDEX "resources_status_idx" ON "resources"("status");

-- CreateIndex
CREATE INDEX "resources_owner_account_id_idx" ON "resources"("owner_account_id");

-- CreateIndex
CREATE INDEX "resources_cf_id_idx" ON "resources"("cf_id");

-- CreateIndex
CREATE INDEX "resources_account_id_idx" ON "resources"("account_id");

-- CreateIndex
CREATE INDEX "run_events_type_idx" ON "run_events"("type");

-- CreateIndex
CREATE INDEX "run_events_run_id_type_created_at_idx" ON "run_events"("run_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "run_events_run_id_idx" ON "run_events"("run_id");

-- CreateIndex
CREATE INDEX "runs_worker_id_idx" ON "runs"("worker_id");

-- CreateIndex
CREATE INDEX "runs_worker_heartbeat_idx" ON "runs"("worker_heartbeat");

-- CreateIndex
CREATE INDEX "runs_thread_id_status_idx" ON "runs"("thread_id", "status");

-- CreateIndex
CREATE INDEX "runs_thread_id_idx" ON "runs"("thread_id");

-- CreateIndex
CREATE INDEX "runs_status_idx" ON "runs"("status");

-- CreateIndex
CREATE INDEX "runs_session_id_idx" ON "runs"("session_id");

-- CreateIndex
CREATE INDEX "runs_parent_run_id_idx" ON "runs"("parent_run_id");

-- CreateIndex
CREATE INDEX "runs_agent_type_idx" ON "runs"("agent_type");

-- CreateIndex
CREATE INDEX "runs_account_id_status_idx" ON "runs"("account_id", "status");

-- CreateIndex
CREATE INDEX "runs_account_id_status_created_at_idx" ON "runs"("account_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "runs_account_id_idx" ON "runs"("account_id");

-- CreateIndex
CREATE INDEX "runs_account_id_created_at_idx" ON "runs"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_tokens_token_hash_key" ON "service_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "service_tokens_token_hash_idx" ON "service_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "session_files_session_id_idx" ON "session_files"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_files_session_id_path_key" ON "session_files"("session_id", "path");

-- CreateIndex
CREATE INDEX "session_repos_session_id_is_primary_idx" ON "session_repos"("session_id", "is_primary");

-- CreateIndex
CREATE INDEX "session_repos_session_id_idx" ON "session_repos"("session_id");

-- CreateIndex
CREATE INDEX "session_repos_repo_id_idx" ON "session_repos"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_repos_session_id_repo_id_key" ON "session_repos"("session_id", "repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_repos_session_id_mount_path_key" ON "session_repos"("session_id", "mount_path");

-- CreateIndex
CREATE INDEX "sessions_user_account_id_idx" ON "sessions"("user_account_id");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "sessions_repo_id_idx" ON "sessions"("repo_id");

-- CreateIndex
CREATE INDEX "sessions_last_heartbeat_idx" ON "sessions"("last_heartbeat");

-- CreateIndex
CREATE INDEX "sessions_account_id_idx" ON "sessions"("account_id");

-- CreateIndex
CREATE INDEX "shortcut_group_items_group_id_idx" ON "shortcut_group_items"("group_id");

-- CreateIndex
CREATE INDEX "shortcut_groups_account_id_idx" ON "shortcut_groups"("account_id");

-- CreateIndex
CREATE INDEX "shortcuts_user_account_id_idx" ON "shortcuts"("user_account_id");

-- CreateIndex
CREATE INDEX "shortcuts_resource_type_resource_id_idx" ON "shortcuts"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "shortcuts_account_id_idx" ON "shortcuts"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "shortcuts_user_account_id_resource_type_resource_id_key" ON "shortcuts"("user_account_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "skills_enabled_idx" ON "skills"("enabled");

-- CreateIndex
CREATE INDEX "skills_account_id_idx" ON "skills"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_account_id_name_key" ON "skills"("account_id", "name");

-- CreateIndex
CREATE INDEX "snapshots_status_idx" ON "snapshots"("status");

-- CreateIndex
CREATE INDEX "snapshots_account_id_idx" ON "snapshots"("account_id");

-- CreateIndex
CREATE INDEX "tags_repo_id_idx" ON "tags"("repo_id");

-- CreateIndex
CREATE INDEX "tags_commit_sha_idx" ON "tags"("commit_sha");

-- CreateIndex
CREATE UNIQUE INDEX "tags_repo_id_name_key" ON "tags"("repo_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "thread_shares_token_key" ON "thread_shares"("token");

-- CreateIndex
CREATE INDEX "thread_shares_thread_id_idx" ON "thread_shares"("thread_id");

-- CreateIndex
CREATE INDEX "thread_shares_expires_at_idx" ON "thread_shares"("expires_at");

-- CreateIndex
CREATE INDEX "thread_shares_created_by_account_id_idx" ON "thread_shares"("created_by_account_id");

-- CreateIndex
CREATE INDEX "thread_shares_account_id_idx" ON "thread_shares"("account_id");

-- CreateIndex
CREATE INDEX "threads_status_idx" ON "threads"("status");

-- CreateIndex
CREATE INDEX "threads_account_id_idx" ON "threads"("account_id");

-- CreateIndex
CREATE INDEX "ui_extensions_account_id_idx" ON "ui_extensions"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ui_extensions_account_id_path_key" ON "ui_extensions"("account_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "idx_usage_events_idempotency_key" ON "usage_events"("idempotency_key");

-- CreateIndex
CREATE INDEX "usage_events_reference_id_idx" ON "usage_events"("reference_id");

-- CreateIndex
CREATE INDEX "usage_events_meter_type_idx" ON "usage_events"("meter_type");

-- CreateIndex
CREATE INDEX "usage_events_created_at_idx" ON "usage_events"("created_at");

-- CreateIndex
CREATE INDEX "usage_events_billing_account_id_idx" ON "usage_events"("billing_account_id");

-- CreateIndex
CREATE INDEX "usage_events_account_id_idx" ON "usage_events"("account_id");

-- CreateIndex
CREATE INDEX "usage_rollups_period_start_idx" ON "usage_rollups"("period_start");

-- CreateIndex
CREATE INDEX "usage_rollups_billing_account_id_idx" ON "usage_rollups"("billing_account_id");

-- CreateIndex
CREATE INDEX "usage_rollups_account_id_idx" ON "usage_rollups"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "usage_rollups_billing_account_id_scope_type_account_id_meter_type_period_start_key" ON "usage_rollups"("billing_account_id", "scope_type", "account_id", "meter_type", "period_start");

-- CreateIndex
CREATE INDEX "worker_bindings_worker_id_idx" ON "worker_bindings"("worker_id");

-- CreateIndex
CREATE INDEX "worker_bindings_resource_id_idx" ON "worker_bindings"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_bindings_worker_id_binding_name_key" ON "worker_bindings"("worker_id", "binding_name");

-- CreateIndex
CREATE INDEX "worker_common_env_links_worker_id_idx" ON "worker_common_env_links"("worker_id");

-- CreateIndex
CREATE INDEX "worker_common_env_links_sync_state_idx" ON "worker_common_env_links"("sync_state");

-- CreateIndex
CREATE INDEX "worker_common_env_links_account_id_idx" ON "worker_common_env_links"("account_id");

-- CreateIndex
CREATE INDEX "worker_common_env_links_account_id_env_name_idx" ON "worker_common_env_links"("account_id", "env_name");

-- CreateIndex
CREATE UNIQUE INDEX "worker_common_env_links_worker_id_env_name_source_key" ON "worker_common_env_links"("worker_id", "env_name", "source");

-- CreateIndex
CREATE INDEX "worker_env_vars_worker_id_idx" ON "worker_env_vars"("worker_id");

-- CreateIndex
CREATE INDEX "worker_env_vars_account_id_idx" ON "worker_env_vars"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "worker_env_vars_worker_id_name_key" ON "worker_env_vars"("worker_id", "name");

-- CreateIndex
CREATE INDEX "worker_runtime_settings_account_id_idx" ON "worker_runtime_settings"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "workers_hostname_key" ON "workers"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "workers_worker_name_key" ON "workers"("worker_name");

-- CreateIndex
CREATE UNIQUE INDEX "workers_slug_key" ON "workers"("slug");

-- CreateIndex
CREATE INDEX "workers_status_idx" ON "workers"("status");

-- CreateIndex
CREATE INDEX "workers_hostname_idx" ON "workers"("hostname");

-- CreateIndex
CREATE INDEX "workers_account_id_status_idx" ON "workers"("account_id", "status");

-- CreateIndex
CREATE INDEX "workers_account_id_idx" ON "workers"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "workers_id_account_id_key" ON "workers"("id", "account_id");

-- CreateIndex
CREATE INDEX "workflow_artifacts_run_id_idx" ON "workflow_artifacts"("run_id");

-- CreateIndex
CREATE INDEX "workflow_artifacts_expires_at_idx" ON "workflow_artifacts"("expires_at");

-- CreateIndex
CREATE INDEX "workflow_jobs_status_idx" ON "workflow_jobs"("status");

-- CreateIndex
CREATE INDEX "workflow_jobs_run_id_idx" ON "workflow_jobs"("run_id");

-- CreateIndex
CREATE INDEX "workflow_runs_workflow_id_idx" ON "workflow_runs"("workflow_id");

-- CreateIndex
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs"("status");

-- CreateIndex
CREATE INDEX "workflow_runs_repo_id_idx" ON "workflow_runs"("repo_id");

-- CreateIndex
CREATE INDEX "workflow_runs_event_idx" ON "workflow_runs"("event");

-- CreateIndex
CREATE INDEX "workflow_runs_created_at_idx" ON "workflow_runs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "workflow_runs_actor_account_id_idx" ON "workflow_runs"("actor_account_id");

-- CreateIndex
CREATE INDEX "workflow_secrets_repo_id_idx" ON "workflow_secrets"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_secrets_repo_id_name_key" ON "workflow_secrets"("repo_id", "name");

-- CreateIndex
CREATE INDEX "workflow_steps_job_id_number_idx" ON "workflow_steps"("job_id", "number");

-- CreateIndex
CREATE INDEX "workflow_steps_job_id_idx" ON "workflow_steps"("job_id");

-- CreateIndex
CREATE INDEX "workflows_repo_id_idx" ON "workflows"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_repo_id_path_key" ON "workflows"("repo_id", "path");
```

## takos-paas Core schema (Deployment-centric)

`takos-paas` の Deploy では、Core record は `deployments` /
`provider_observations` / `group_heads` の 3 つに圧縮されます。Phase 2 migration
(`takos/paas/apps/paas/db/migrations/20260430000010_unify_to_deployments.sql`)
は v2 の `deploy_plans` / `deploy_activation_records` /
`deploy_operation_records` / `deploy_group_activation_pointers` を `deployments`
に collapse し、`resource_binding_set_revisions` の structural side は
`deployments.desired.bindings` field に内包します。`resource_migration_ledger`
は forward-only history record として独立に維持されます。完全な spec は
[Core contract v1.0 § 13–§ 18](/takos-paas/core/01-core-contract-v1.0)。

```sql
-- current baseline: Deployment / ProviderObservation / GroupHead
CREATE TABLE deployments (
    "id"                       TEXT        NOT NULL PRIMARY KEY,
    "group_id"                 TEXT        NOT NULL,
    "space_id"                 TEXT        NOT NULL,
    "input_json"               JSONB       NOT NULL,
    "resolution_json"          JSONB       NOT NULL,
    "desired_json"             JSONB       NOT NULL,
    "status"                   TEXT        NOT NULL
        CHECK (status IN ('preview','resolved','applying','applied','failed','rolled-back')),
    "conditions_json"          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "policy_decisions_json"    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    "approval_json"            JSONB,
    "rollback_target"          TEXT        REFERENCES "deployments"("id"),
    "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_at"               TIMESTAMPTZ,
    "finalized_at"             TIMESTAMPTZ
);

CREATE INDEX "deployments_group_created_idx"
    ON "deployments" ("group_id", "created_at" DESC);
CREATE INDEX "deployments_status_idx"
    ON "deployments" ("status");
CREATE INDEX "deployments_space_idx"
    ON "deployments" ("space_id");

-- ProviderObservation: append-only stream of observed provider state.
-- Never canonical (Deployment.desired is the canonical desired state).
CREATE TABLE provider_observations (
    "id"                  TEXT        NOT NULL PRIMARY KEY,
    "deployment_id"       TEXT        NOT NULL REFERENCES "deployments"("id"),
    "provider_id"         TEXT        NOT NULL,
    "object_address"      TEXT        NOT NULL,
    "observed_state"      TEXT        NOT NULL
        CHECK (observed_state IN ('present','missing','drifted','unknown')),
    "drift_status"        TEXT,
    "observed_digest"     TEXT,
    "observed_state_json" JSONB       NOT NULL DEFAULT '{}'::jsonb,
    "observed_at"         TIMESTAMPTZ NOT NULL
);

CREATE INDEX "provider_observations_deployment_idx"
    ON "provider_observations" ("deployment_id");
CREATE INDEX "provider_observations_observed_at_idx"
    ON "provider_observations" ("observed_at" DESC);

-- GroupHead: strongly consistent pointer to a group's current Deployment.
-- Rollback flips current_deployment_id <-> previous_deployment_id atomically.
CREATE TABLE group_heads (
    "group_id"                  TEXT        NOT NULL PRIMARY KEY,
    "current_deployment_id"     TEXT        NOT NULL REFERENCES "deployments"("id"),
    "previous_deployment_id"    TEXT        REFERENCES "deployments"("id"),
    "generation"                BIGINT      NOT NULL DEFAULT 1,
    "advanced_at"               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX "group_heads_current_idx"
    ON "group_heads" ("current_deployment_id");
```

### Migration notes

`takos/paas` Core schema は SQLite / D1 baseline からは独立した PostgreSQL
backend として配布されます。control plane の SQLite / D1 baseline（このページ
冒頭の schema）は Takos app gateway / Git hosting / billing / sessions など の
primary store であり、`deployments` テーブル名は **app/gateway worker deployment
record** 用に予約されています（PaaS Core の Deployment record
ではない）。両者の混同を避けるため、PaaS Core 配下の table は
`takos/paas/apps/paas/db/migrations/` の独立 migration として管理されます。 v2
PaaS で存在した `deploy_plans` / `deploy_activation_records` /
`deploy_operation_records` / `deploy_group_activation_pointers` /
`resource_binding_set_revisions` の structural columns は deployment migration
で `deployments` (3 JSONB field) と `group_heads` に折り畳まれ、history は
preserve されます。
