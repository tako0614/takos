import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { nowIso } from './schema-helpers';

// 108. WorkflowArtifact
export const workflowArtifacts = sqliteTable('workflow_artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  name: text('name').notNull(),
  r2Key: text('r2_key').notNull(),
  sizeBytes: integer('size_bytes'),
  mimeType: text('mime_type'),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxRun: index('idx_workflow_artifacts_run_id').on(table.runId),
  idxExpiresAt: index('idx_workflow_artifacts_expires_at').on(table.expiresAt),
}));

// 109. WorkflowJob
export const workflowJobs = sqliteTable('workflow_jobs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  jobKey: text('job_key'),
  name: text('name').notNull(),
  status: text('status').notNull().default('queued'),
  conclusion: text('conclusion'),
  runnerId: text('runner_id'),
  runnerName: text('runner_name'),
  queuedAt: text('queued_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  logsUrl: text('logs_url'),
  logsR2Key: text('logs_r2_key'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxStatus: index('idx_workflow_jobs_status').on(table.status),
  idxRun: index('idx_workflow_jobs_run_id').on(table.runId),
}));

// 110. WorkflowRun
export const workflowRuns = sqliteTable('workflow_runs', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  workflowId: text('workflow_id'),
  workflowPath: text('workflow_path').notNull(),
  event: text('event').notNull(),
  ref: text('ref'),
  sha: text('sha'),
  actorAccountId: text('actor_account_id'),
  status: text('status').notNull().default('queued'),
  conclusion: text('conclusion'),
  queuedAt: text('queued_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  inputs: text('inputs'),
  runNumber: integer('run_number'),
  runAttempt: integer('run_attempt').notNull().default(1),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxWorkflow: index('idx_workflow_runs_workflow_id').on(table.workflowId),
  idxStatus: index('idx_workflow_runs_status').on(table.status),
  idxRepo: index('idx_workflow_runs_repo_id').on(table.repoId),
  idxEvent: index('idx_workflow_runs_event').on(table.event),
  idxCreatedAt: index('idx_workflow_runs_created_at').on(table.createdAt),
  idxActor: index('idx_workflow_runs_actor_account_id').on(table.actorAccountId),
}));

// 111. WorkflowSecret
export const workflowSecrets = sqliteTable('workflow_secrets', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  name: text('name').notNull(),
  encryptedValue: text('encrypted_value').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at'),
}, (table) => ({
  uniqRepoName: uniqueIndex('idx_workflow_secrets_repo_name').on(table.repoId, table.name),
  idxRepo: index('idx_workflow_secrets_repo_id').on(table.repoId),
}));

// 112. WorkflowStep
export const workflowSteps = sqliteTable('workflow_steps', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('pending'),
  conclusion: text('conclusion'),
  runCommand: text('run_command'),
  usesAction: text('uses_action'),
  exitCode: integer('exit_code'),
  errorMessage: text('error_message'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxJobNumber: index('idx_workflow_steps_job_number').on(table.jobId, table.number),
  idxJob: index('idx_workflow_steps_job_id').on(table.jobId),
}));

// 113. Workflow
export const workflows = sqliteTable('workflows', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  path: text('path').notNull(),
  name: text('name'),
  content: text('content').notNull(),
  triggers: text('triggers'),
  parsedAt: text('parsed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at'),
}, (table) => ({
  uniqRepoPath: uniqueIndex('idx_workflows_repo_path').on(table.repoId, table.path),
  idxRepo: index('idx_workflows_repo_id').on(table.repoId),
}));
