import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { nowIso } from './schema-helpers';

// 13. AgentTask
export const agentTasks = sqliteTable('agent_tasks', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  createdByAccountId: text('created_by_account_id'),
  threadId: text('thread_id'),
  lastRunId: text('last_run_id'),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('planned'),
  priority: text('priority').notNull().default('medium'),
  agentType: text('agent_type').notNull().default('default'),
  model: text('model'),
  plan: text('plan'),
  dueAt: text('due_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  idxThread: index('idx_agent_tasks_thread_id').on(table.threadId),
  idxStatus: index('idx_agent_tasks_status').on(table.status),
  idxPriority: index('idx_agent_tasks_priority').on(table.priority),
  idxLastRun: index('idx_agent_tasks_last_run_id').on(table.lastRunId),
  idxCreatedBy: index('idx_agent_tasks_created_by_account_id').on(table.createdByAccountId),
  idxAccountStatus: index('idx_agent_tasks_account_status').on(table.accountId, table.status),
  idxAccount: index('idx_agent_tasks_account_id').on(table.accountId),
  idxAccountCreatedAt: index('idx_agent_tasks_account_created_at').on(table.accountId, table.createdAt),
}));

// 15. Artifact
export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  accountId: text('account_id').notNull(),
  type: text('type').notNull().default('code'),
  title: text('title'),
  content: text('content'),
  fileId: text('file_id'),
  metadata: text('metadata').notNull().default('{}'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxType: index('idx_artifacts_type').on(table.type),
  idxRun: index('idx_artifacts_run_id').on(table.runId),
  idxFile: index('idx_artifacts_file_id').on(table.fileId),
  idxAccount: index('idx_artifacts_account_id').on(table.accountId),
}));

// 42. InfoUnit
export const infoUnits = sqliteTable('info_units', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  threadId: text('thread_id'),
  runId: text('run_id'),
  sessionId: text('session_id'),
  kind: text('kind').notNull().default('session'),
  title: text('title'),
  content: text('content').notNull(),
  tokenCount: integer('token_count').notNull().default(0),
  segmentIndex: integer('segment_index').notNull().default(0),
  segmentCount: integer('segment_count').notNull().default(1),
  vectorId: text('vector_id'),
  metadata: text('metadata').notNull().default('{}'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  idxThread: index('idx_info_units_thread_id').on(table.threadId),
  idxSession: index('idx_info_units_session_id').on(table.sessionId),
  idxRun: index('idx_info_units_run_id').on(table.runId),
  idxKind: index('idx_info_units_kind').on(table.kind),
  idxAccount: index('idx_info_units_account_id').on(table.accountId),
}));

// 46. LgCheckpoint
export const lgCheckpoints = sqliteTable('lg_checkpoints', {
  threadId: text('thread_id').notNull(),
  checkpointNs: text('checkpoint_ns').notNull().default(''),
  checkpointId: text('checkpoint_id').notNull(),
  parentCheckpointId: text('parent_checkpoint_id'),
  ts: text('ts').notNull(),
  checkpointType: text('checkpoint_type').notNull(),
  checkpointData: text('checkpoint_data').notNull(),
  metadataType: text('metadata_type'),
  metadataData: text('metadata_data'),
  sessionId: text('session_id'),
  snapshotId: text('snapshot_id'),
}, (table) => ({
  pk: primaryKey({ columns: [table.threadId, table.checkpointNs, table.checkpointId] }),
  idxTs: index('idx_lg_checkpoints_ts').on(table.ts),
  idxThreadNs: index('idx_lg_checkpoints_thread_ns').on(table.threadId, table.checkpointNs),
}));

// 47. LgWrite
export const lgWrites = sqliteTable('lg_writes', {
  threadId: text('thread_id').notNull(),
  checkpointNs: text('checkpoint_ns').notNull().default(''),
  checkpointId: text('checkpoint_id').notNull(),
  taskId: text('task_id').notNull(),
  channel: text('channel').notNull(),
  valueType: text('value_type').notNull(),
  valueData: text('value_data').notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.threadId, table.checkpointNs, table.checkpointId, table.taskId, table.channel] }),
  idxThreadNsCheckpoint: index('idx_lg_writes_thread_ns_checkpoint').on(table.threadId, table.checkpointNs, table.checkpointId),
}));

// 52. Memory
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  authorAccountId: text('author_account_id'),
  threadId: text('thread_id'),
  type: text('type').notNull(),
  category: text('category'),
  content: text('content').notNull(),
  summary: text('summary'),
  importance: real('importance').default(0.5),
  tags: text('tags'),
  occurredAt: text('occurred_at'),
  expiresAt: text('expires_at'),
  lastAccessedAt: text('last_accessed_at'),
  accessCount: integer('access_count').default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  idxType: index('idx_memories_type').on(table.type),
  idxTypeCategory: index('idx_memories_type_category').on(table.type, table.category),
  idxThread: index('idx_memories_thread_id').on(table.threadId),
  idxImportance: index('idx_memories_importance').on(table.importance),
  idxAuthor: index('idx_memories_author_account_id').on(table.authorAccountId),
  idxAccount: index('idx_memories_account_id').on(table.accountId),
}));

// 53. Message
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  r2Key: text('r2_key'),
  toolCalls: text('tool_calls'),
  toolCallId: text('tool_call_id'),
  metadata: text('metadata').notNull().default('{}'),
  sequence: integer('sequence').notNull().default(0),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxThreadSequence: index('idx_messages_thread_sequence').on(table.threadId, table.sequence),
  idxThread: index('idx_messages_thread_id').on(table.threadId),
  idxThreadCreatedAt: index('idx_messages_thread_created_at').on(table.threadId, table.createdAt),
}));

// 72. Reminder
export const reminders = sqliteTable('reminders', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  ownerAccountId: text('owner_account_id'),
  content: text('content').notNull(),
  context: text('context'),
  triggerType: text('trigger_type').notNull(),
  triggerValue: text('trigger_value'),
  status: text('status').default('pending'),
  triggeredAt: text('triggered_at'),
  priority: text('priority').default('normal'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  idxStatus: index('idx_reminders_status').on(table.status),
  idxPriority: index('idx_reminders_priority').on(table.priority),
  idxAccount: index('idx_reminders_account_id').on(table.accountId),
}));

// 83. RunEvent
export const runEvents = sqliteTable('run_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull(),
  type: text('type').notNull(),
  data: text('data').notNull().default('{}'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxType: index('idx_run_events_type').on(table.type),
  idxRunTypeCreatedAt: index('idx_run_events_run_type_created_at').on(table.runId, table.type, table.createdAt),
  idxRun: index('idx_run_events_run_id').on(table.runId),
}));

// 84. Run
const runsTable = sqliteTable('runs', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  accountId: text('account_id').notNull(),
  requesterAccountId: text('requester_account_id'),
  sessionId: text('session_id'),
  parentRunId: text('parent_run_id'),
  childThreadId: text('child_thread_id'),
  rootThreadId: text('root_thread_id'),
  rootRunId: text('root_run_id'),
  agentType: text('agent_type').notNull().default('default'),
  status: text('status').notNull().default('queued'),
  lastEventId: integer('last_event_id').notNull().default(0),
  input: text('input').notNull().default('{}'),
  output: text('output'),
  error: text('error'),
  usage: text('usage').notNull().default('{}'),
  serviceId: text('service_id'),
  serviceHeartbeat: text('service_heartbeat'),
  leaseVersion: integer('lease_version').notNull().default(0),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxService: index('idx_runs_service_id').on(table.serviceId),
  idxServiceHeartbeat: index('idx_runs_service_heartbeat').on(table.serviceHeartbeat),
  idxThreadStatus: index('idx_runs_thread_status').on(table.threadId, table.status),
  idxThread: index('idx_runs_thread_id').on(table.threadId),
  idxStatus: index('idx_runs_status').on(table.status),
  idxSession: index('idx_runs_session_id').on(table.sessionId),
  idxRequester: index('idx_runs_requester_account_id').on(table.requesterAccountId),
  idxParentRun: index('idx_runs_parent_run_id').on(table.parentRunId),
  idxChildThread: index('idx_runs_child_thread_id').on(table.childThreadId),
  idxRootThread: index('idx_runs_root_thread_id').on(table.rootThreadId),
  idxRootRun: index('idx_runs_root_run_id').on(table.rootRunId),
  idxAgentType: index('idx_runs_agent_type').on(table.agentType),
  idxAccountStatus: index('idx_runs_account_status').on(table.accountId, table.status),
  idxAccountStatusCreatedAt: index('idx_runs_account_status_created_at').on(table.accountId, table.status, table.createdAt),
  idxAccount: index('idx_runs_account_id').on(table.accountId),
  idxAccountCreatedAt: index('idx_runs_account_created_at').on(table.accountId, table.createdAt),
}));

export const runs = Object.assign(runsTable, {
  workerId: runsTable.serviceId,
  workerHeartbeat: runsTable.serviceHeartbeat,
});

// 92. Skill
export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  instructions: text('instructions').notNull(),
  triggers: text('triggers'),
  metadata: text('metadata').notNull().default('{}'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  uniqAccountName: uniqueIndex('idx_skills_account_name').on(table.accountId, table.name),
  idxEnabled: index('idx_skills_enabled').on(table.enabled),
  idxAccount: index('idx_skills_account_id').on(table.accountId),
}));

// 95. ThreadShare
export const threadShares = sqliteTable('thread_shares', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  accountId: text('account_id').notNull(),
  createdByAccountId: text('created_by_account_id'),
  token: text('token').notNull().unique(),
  mode: text('mode').notNull().default('public'),
  passwordHash: text('password_hash'),
  expiresAt: text('expires_at'),
  revokedAt: text('revoked_at'),
  lastAccessedAt: text('last_accessed_at'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
}, (table) => ({
  idxThread: index('idx_thread_shares_thread_id').on(table.threadId),
  idxExpiresAt: index('idx_thread_shares_expires_at').on(table.expiresAt),
  idxCreatedBy: index('idx_thread_shares_created_by_account_id').on(table.createdByAccountId),
  idxAccount: index('idx_thread_shares_account_id').on(table.accountId),
}));

// 96. Thread
export const threads = sqliteTable('threads', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  title: text('title'),
  locale: text('locale'),
  status: text('status').notNull().default('active'),
  summary: text('summary'),
  keyPoints: text('key_points').notNull().default('[]'),
  retrievalIndex: integer('retrieval_index').notNull().default(-1),
  contextWindow: integer('context_window').notNull().default(50),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  updatedAt: text('updated_at').notNull().$defaultFn(() => nowIso()).$onUpdateFn(() => nowIso()),
}, (table) => ({
  idxStatus: index('idx_threads_status').on(table.status),
  idxAccount: index('idx_threads_account_id').on(table.accountId),
}));

// 97. ToolOperation (idempotent tool execution tracking)
export const toolOperations = sqliteTable('tool_operations', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  operationKey: text('operation_key').notNull(),
  toolName: text('tool_name').notNull(),
  status: text('status').notNull().default('pending'),
  resultOutput: text('result_output'),
  resultError: text('result_error'),
  createdAt: text('created_at').notNull().$defaultFn(() => nowIso()),
  completedAt: text('completed_at'),
}, (table) => ({
  uniqRunOpKey: uniqueIndex('idx_tool_operations_key').on(table.runId, table.operationKey),
  idxRunId: index('idx_tool_operations_run_id').on(table.runId),
}));
