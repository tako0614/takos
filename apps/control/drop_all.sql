PRAGMA foreign_keys = OFF;

-- Drop the canonical Takos schema inventory in child-first order.

-- Workflow / repository leaf tables
DROP TABLE IF EXISTS file_handler_matchers;
DROP TABLE IF EXISTS workflow_steps;
DROP TABLE IF EXISTS workflow_jobs;
DROP TABLE IF EXISTS workflow_artifacts;
DROP TABLE IF EXISTS workflow_runs;
DROP TABLE IF EXISTS workflow_secrets;
DROP TABLE IF EXISTS workflows;
DROP TABLE IF EXISTS pr_comments;
DROP TABLE IF EXISTS pr_reviews;
DROP TABLE IF EXISTS pull_requests;
DROP TABLE IF EXISTS repo_release_assets;
DROP TABLE IF EXISTS repo_releases;
DROP TABLE IF EXISTS repo_stars;
DROP TABLE IF EXISTS repo_forks;
DROP TABLE IF EXISTS repo_remotes;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS commits;
DROP TABLE IF EXISTS branches;
DROP TABLE IF EXISTS git_file_changes;
DROP TABLE IF EXISTS git_commits;

-- Session / runtime leaf tables
DROP TABLE IF EXISTS session_files;
DROP TABLE IF EXISTS session_repos;
DROP TABLE IF EXISTS lg_writes;
DROP TABLE IF EXISTS lg_checkpoints;

-- UI / app surface
DROP TABLE IF EXISTS shortcut_group_items;
DROP TABLE IF EXISTS shortcut_groups;
DROP TABLE IF EXISTS shortcuts;
DROP TABLE IF EXISTS ui_extensions;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS apps;

-- Threads / runs / memory / indexing
DROP TABLE IF EXISTS run_events;
DROP TABLE IF EXISTS artifacts;
DROP TABLE IF EXISTS agent_tasks;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS thread_shares;
DROP TABLE IF EXISTS info_units;
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS memories;
DROP TABLE IF EXISTS chunks;
DROP TABLE IF EXISTS edges;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS index_jobs;
DROP TABLE IF EXISTS runs;

-- Auth / OAuth
DROP TABLE IF EXISTS oauth_tokens;
DROP TABLE IF EXISTS oauth_device_codes;
DROP TABLE IF EXISTS oauth_authorization_codes;
DROP TABLE IF EXISTS oauth_consents;
DROP TABLE IF EXISTS oauth_audit_logs;
DROP TABLE IF EXISTS oauth_clients;
DROP TABLE IF EXISTS oauth_states;
DROP TABLE IF EXISTS auth_sessions;
DROP TABLE IF EXISTS auth_identities;
DROP TABLE IF EXISTS auth_services;
DROP TABLE IF EXISTS personal_access_tokens;
DROP TABLE IF EXISTS service_tokens;

-- Notifications / moderation / social / billing
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS notification_settings;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS moderation_audit_logs;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS account_moderation;
DROP TABLE IF EXISTS account_follow_requests;
DROP TABLE IF EXISTS account_blocks;
DROP TABLE IF EXISTS account_mutes;
DROP TABLE IF EXISTS account_follows;
DROP TABLE IF EXISTS account_settings;
DROP TABLE IF EXISTS usage_events;
DROP TABLE IF EXISTS usage_rollups;
DROP TABLE IF EXISTS billing_transactions;
DROP TABLE IF EXISTS billing_accounts;
DROP TABLE IF EXISTS billing_plan_features;
DROP TABLE IF EXISTS billing_plan_quotas;
DROP TABLE IF EXISTS billing_plan_rates;
DROP TABLE IF EXISTS billing_plans;

-- Worker / deploy / resource / takopack
DROP TABLE IF EXISTS worker_mcp_endpoints;
DROP TABLE IF EXISTS worker_runtime_limits;
DROP TABLE IF EXISTS worker_runtime_flags;
DROP TABLE IF EXISTS worker_common_env_links;
DROP TABLE IF EXISTS worker_env_vars;
DROP TABLE IF EXISTS managed_takos_tokens;
DROP TABLE IF EXISTS common_env_reconcile_jobs;
DROP TABLE IF EXISTS common_env_audit_logs;
DROP TABLE IF EXISTS worker_bindings;
DROP TABLE IF EXISTS resource_access_tokens;
DROP TABLE IF EXISTS resource_access;
DROP TABLE IF EXISTS mcp_servers;
DROP TABLE IF EXISTS mcp_oauth_pending;
DROP TABLE IF EXISTS infra_endpoint_routes;
DROP TABLE IF EXISTS infra_endpoints;
DROP TABLE IF EXISTS infra_workers;
DROP TABLE IF EXISTS file_handlers;
DROP TABLE IF EXISTS bundle_deployment_events;
DROP TABLE IF EXISTS resources;
DROP TABLE IF EXISTS worker_runtime_settings;
DROP TABLE IF EXISTS deployment_events;
DROP TABLE IF EXISTS custom_domains;
DROP TABLE IF EXISTS deployments;
DROP TABLE IF EXISTS workers;
DROP TABLE IF EXISTS bundle_deployments;

-- Files / repositories / account hierarchy
DROP TABLE IF EXISTS files;
DROP TABLE IF EXISTS blobs;
DROP TABLE IF EXISTS snapshots;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS repositories;
DROP TABLE IF EXISTS account_metadata;
DROP TABLE IF EXISTS account_storage_files;
DROP TABLE IF EXISTS account_memberships;
DROP TABLE IF EXISTS account_env_vars;
DROP TABLE IF EXISTS account_stats;
DROP TABLE IF EXISTS threads;

-- Identity root
DROP TABLE IF EXISTS accounts;

-- Migration tracking
DROP TABLE IF EXISTS d1_migrations;

PRAGMA foreign_keys = ON;
