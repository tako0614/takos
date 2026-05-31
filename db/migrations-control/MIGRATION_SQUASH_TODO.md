# D1 Migration Squash TODO

## Current State

- **Migration count**: 79 SQL files (0001 through 0077, plus seed and baseline)
- **Accumulated since**: project inception (0001_baseline.sql)

## Recommendation

When D1 supports migration squashing or baseline reset, consolidate all 79
migrations into a single baseline schema. This will:

1. Reduce `wrangler d1 migrations apply` time on fresh databases
2. Remove historical ALTER/DROP noise that obscures current schema intent
3. Simplify onboarding for new contributors

Do NOT squash manually in production today -- existing D1 databases track
applied migration tags and a forced reset risks data loss.

## Baseline Schema Tables

The squashed baseline should include the following tables (alphabetical):

- account_blocks
- account_env_vars
- account_follow_requests
- account_follows
- account_memberships
- account_metadata
- account_moderation
- account_mutes
- account_password_credentials
- account_settings
- account_stats
- account_storage_files
- accounts
- agent_tasks
- ap_delivery_queue
- ap_followers
- app_usage_events
- app_usage_rollups
- apps
- artifacts
- auth_identities
- auth_services
- auth_sessions
- billing_accounts
- billing_auto_purchase_settings
- billing_plan_features
- billing_plan_quotas
- billing_plan_rates
- billing_plans
- billing_transactions
- blobs
- branches
- bundle_deployment_events
- bundle_deployments
- chunks
- commits
- common_env_audit_logs
- common_env_reconcile_jobs
- custom_domains
- default_app_distribution_config
- default_app_distribution_entries
- default_app_preinstall_jobs
- deployment_events
- deployments
- edges
- file_handler_matchers
- file_handlers
- files
- git_commits
- git_file_changes
- group_deployment_snapshots
- group_entities
- groups
- index_jobs
- info_units
- infra_endpoint_routes
- infra_endpoints
- infra_workers
- lg_checkpoints
- lg_writes
- managed_takos_tokens
- mcp_oauth_pending
- mcp_servers
- memories
- memory_claim_edges
- memory_claims
- memory_evidence
- memory_paths
- messages
- moderation_audit_logs
- nodes
- notification_preferences
- notification_settings
- notifications
- oauth_audit_logs
- oauth_authorization_codes
- oauth_clients
- oauth_consents
- oauth_device_codes
- oauth_states
- oauth_tokens
- pat_revoked
- personal_access_tokens
- pr_comments
- pr_reviews
- publications
- pull_requests
- reminders
- repo_forks
- repo_grants
- repo_push_activities
- repo_release_assets
- repo_releases
- repo_remotes
- repo_stars
- repositories
- reports
- resource_access
- resource_access_tokens
- resources
- run_events
- runs
- secret_rotation_events
- secret_versions
- service_bindings
- service_common_env_links
- service_consumes
- service_runtime_settings
- service_tokens
- services
- session_files
- session_repos
- sessions
- sessions_revoked
- shortcut_group_items
- shortcut_groups
- shortcuts
- skills
- snapshots
- store_inventory_items
- store_registry
- store_registry_updates
- stripe_webhook_events
- tags
- tenant_workflow_instances
- thread_shares
- threads
- tool_operations
- ui_extensions
- usage_events
- usage_rollups
- worker_bindings
- worker_common_env_links
- worker_env_vars
- worker_mcp_endpoints
- worker_runtime_flags
- worker_runtime_limits
- worker_runtime_settings
- workers
- workflow_artifacts
- workflow_jobs
- workflow_runs
- workflow_secrets
- workflow_steps
- workflows

## Prerequisites for Squash

1. D1 adds official support for migration baseline/reset
2. All production and staging databases are on migration 0077+
3. A verified `pg_dump`-equivalent schema snapshot is captured before squash
