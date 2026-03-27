-- Tenant workflow instance state for non-Cloudflare environments.
-- Provides the storage backend for the Workflow binding adapter.

CREATE TABLE IF NOT EXISTS tenant_workflow_instances (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  workflow_name TEXT NOT NULL,
  params TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  output TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenant_workflows_service
  ON tenant_workflow_instances (service_id, workflow_name);

CREATE INDEX IF NOT EXISTS idx_tenant_workflows_status
  ON tenant_workflow_instances (status);
