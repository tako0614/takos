import {
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn, timestamps } from "./schema-utils.ts";
import { accounts } from "./schema-accounts.ts";

/**
 * Index naming note.
 *
 * The applied baseline SQL and the Drizzle declarations do not always use the
 * same naming convention for equivalent indexes. Treat generated
 * index-name-only diffs as intentional schema-change candidates: either apply
 * the rename consistently to every environment or keep the generated migration
 * a no-op. New table declarations should choose explicit `.index()` names that
 * match their applied SQL so the drift set does not grow.
 */

// 13. AgentTask
export const agentTasks = sqliteTable(
  "agent_tasks",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    createdByAccountId: text("created_by_account_id").references(
      () => accounts.id,
    ),
    threadId: text("thread_id"),
    lastRunId: text("last_run_id"),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("planned"),
    priority: text("priority").notNull().default("medium"),
    agentType: text("agent_type").notNull().default("default"),
    model: text("model"),
    plan: text("plan"),
    dueAt: text("due_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    ...timestamps,
  },
  (table) => ({
    idxThread: index("idx_agent_tasks_thread_id").on(table.threadId),
    idxStatus: index("idx_agent_tasks_status").on(table.status),
    idxPriority: index("idx_agent_tasks_priority").on(table.priority),
    idxLastRun: index("idx_agent_tasks_last_run_id").on(table.lastRunId),
    idxCreatedBy: index("idx_agent_tasks_created_by_account_id").on(
      table.createdByAccountId,
    ),
    idxAccountStatus: index("idx_agent_tasks_account_status").on(
      table.accountId,
      table.status,
    ),
    idxAccount: index("idx_agent_tasks_account_id").on(table.accountId),
    idxAccountCreatedAt: index("idx_agent_tasks_account_created_at").on(
      table.accountId,
      table.createdAt,
    ),
  }),
);

// 15. Artifact
export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runsTable.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    type: text("type").notNull().default("code"),
    title: text("title"),
    content: text("content"),
    fileId: text("file_id"),
    metadata: text("metadata").notNull().default("{}"),
    ...createdAtColumn,
  },
  (table) => ({
    idxType: index("idx_artifacts_type").on(table.type),
    idxRun: index("idx_artifacts_run_id").on(table.runId),
    idxFile: index("idx_artifacts_file_id").on(table.fileId),
    idxAccount: index("idx_artifacts_account_id").on(table.accountId),
  }),
);

// 42. InfoUnit
export const infoUnits = sqliteTable(
  "info_units",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    threadId: text("thread_id").references(() => threads.id),
    runId: text("run_id").references(() => runsTable.id),
    sessionId: text("session_id"),
    kind: text("kind").notNull().default("session"),
    title: text("title"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    segmentIndex: integer("segment_index").notNull().default(0),
    segmentCount: integer("segment_count").notNull().default(1),
    vectorId: text("vector_id"),
    metadata: text("metadata").notNull().default("{}"),
    ...timestamps,
  },
  (table) => ({
    idxThread: index("idx_info_units_thread_id").on(table.threadId),
    idxSession: index("idx_info_units_session_id").on(table.sessionId),
    idxRun: index("idx_info_units_run_id").on(table.runId),
    idxKind: index("idx_info_units_kind").on(table.kind),
    idxAccount: index("idx_info_units_account_id").on(table.accountId),
  }),
);

// 46. LgCheckpoint
export const lgCheckpoints = sqliteTable(
  "lg_checkpoints",
  {
    threadId: text("thread_id").notNull(),
    checkpointNs: text("checkpoint_ns").notNull().default(""),
    checkpointId: text("checkpoint_id").notNull(),
    parentCheckpointId: text("parent_checkpoint_id"),
    ts: text("ts").notNull(),
    checkpointType: text("checkpoint_type").notNull(),
    checkpointData: text("checkpoint_data").notNull(),
    metadataType: text("metadata_type"),
    metadataData: text("metadata_data"),
    sessionId: text("session_id"),
    snapshotId: text("snapshot_id"),
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.threadId, table.checkpointNs, table.checkpointId],
    }),
    idxTs: index("idx_lg_checkpoints_ts").on(table.ts),
    idxThreadNs: index("idx_lg_checkpoints_thread_ns").on(
      table.threadId,
      table.checkpointNs,
    ),
  }),
);

// 47. LgWrite
export const lgWrites = sqliteTable(
  "lg_writes",
  {
    threadId: text("thread_id").notNull(),
    checkpointNs: text("checkpoint_ns").notNull().default(""),
    checkpointId: text("checkpoint_id").notNull(),
    taskId: text("task_id").notNull(),
    channel: text("channel").notNull(),
    valueType: text("value_type").notNull(),
    valueData: text("value_data").notNull(),
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.threadId,
        table.checkpointNs,
        table.checkpointId,
        table.taskId,
        table.channel,
      ],
    }),
    idxThreadNsCheckpoint: index("idx_lg_writes_thread_ns_checkpoint").on(
      table.threadId,
      table.checkpointNs,
      table.checkpointId,
    ),
  }),
);

// 52. Memory
export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    authorAccountId: text("author_account_id").references(() => accounts.id),
    threadId: text("thread_id").references(() => threads.id),
    type: text("type").notNull(),
    category: text("category"),
    content: text("content").notNull(),
    summary: text("summary"),
    importance: real("importance").default(0.5),
    tags: text("tags"),
    occurredAt: text("occurred_at"),
    expiresAt: text("expires_at"),
    lastAccessedAt: text("last_accessed_at"),
    accessCount: integer("access_count").default(0),
    ...timestamps,
  },
  (table) => ({
    idxType: index("idx_memories_type").on(table.type),
    idxTypeCategory: index("idx_memories_type_category").on(
      table.type,
      table.category,
    ),
    idxThread: index("idx_memories_thread_id").on(table.threadId),
    // Baseline SQL creates `memories_importance_idx` with DESC order
    // (`importance DESC`). Drizzle cannot express column-level ASC/DESC inside
    // `index()`, so the physical order is determined by the migration.
    idxImportance: index("idx_memories_importance").on(table.importance),
    idxAuthor: index("idx_memories_author_account_id").on(
      table.authorAccountId,
    ),
    idxAccount: index("idx_memories_account_id").on(table.accountId),
  }),
);

// 52a. Canonical, content-free deletion authority for agent resources.
//
// The source row may be physically removed in the same transaction, while
// this tombstone remains authoritative until the owning Workspace is deleted.
// Derived vector/object replicas are handled by the one-to-one outbox below.
export const agentResourceTombstones = sqliteTable(
  "agent_resource_tombstones",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    sourceDigest: text("source_digest").notNull(),
    deletedByAccountId: text("deleted_by_account_id").references(
      () => accounts.id,
      { onDelete: "set null" },
    ),
    deletedAt: text("deleted_at").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqResource: uniqueIndex("idx_agent_resource_tombstones_resource")
      .on(table.accountId, table.resourceKind, table.resourceId),
    idxAccountDeletedAt: index(
      "idx_agent_resource_tombstones_account_deleted_at",
    ).on(table.accountId, table.deletedAt),
  }),
);

// 52b. Exact cleanup targets captured with the source tombstone. Provider
// cleanup is idempotent and may be retried after a Worker/Queue failure; no
// provider listing or prefix-wide deletion is authorized by this record.
export const agentResourceDeletionOutbox = sqliteTable(
  "agent_resource_deletion_outbox",
  {
    id: text("id").primaryKey().references(() => agentResourceTombstones.id, {
      onDelete: "cascade",
    }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    vectorIds: text("vector_ids").notNull().default("[]"),
    offloadObjectKeys: text("offload_object_keys").notNull().default("[]"),
    deliveryStatus: text("delivery_status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimToken: text("claim_token"),
    claimedAt: text("claimed_at"),
    nextAttemptAt: text("next_attempt_at"),
    completedAt: text("completed_at"),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => ({
    uniqResource: uniqueIndex("idx_agent_resource_deletion_outbox_resource")
      .on(table.accountId, table.resourceKind, table.resourceId),
    idxStatusNextAttempt: index(
      "idx_agent_resource_deletion_outbox_status_next_attempt",
    ).on(table.deliveryStatus, table.nextAttemptAt, table.claimedAt),
  }),
);

// 53. Message
export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    r2Key: text("r2_key"),
    toolCalls: text("tool_calls"),
    toolCallId: text("tool_call_id"),
    metadata: text("metadata").notNull().default("{}"),
    sequence: integer("sequence").notNull().default(0),
    ...createdAtColumn,
  },
  (table) => ({
    idxThreadSequence: uniqueIndex("idx_messages_thread_sequence").on(
      table.threadId,
      table.sequence,
    ),
    idxThread: index("idx_messages_thread_id").on(table.threadId),
    idxThreadCreatedAt: index("idx_messages_thread_created_at").on(
      table.threadId,
      table.createdAt,
    ),
  }),
);

// 72. Reminder
export const reminders = sqliteTable(
  "reminders",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    ownerAccountId: text("owner_account_id").references(() => accounts.id),
    content: text("content").notNull(),
    context: text("context"),
    triggerType: text("trigger_type").notNull(),
    triggerValue: text("trigger_value"),
    status: text("status").default("pending"),
    triggeredAt: text("triggered_at"),
    priority: text("priority").default("normal"),
    ...timestamps,
  },
  (table) => ({
    idxStatus: index("idx_reminders_status").on(table.status),
    idxPriority: index("idx_reminders_priority").on(table.priority),
    idxAccount: index("idx_reminders_account_id").on(table.accountId),
  }),
);

// 83. RunEvent
export const runEvents = sqliteTable(
  "run_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: text("run_id")
      .notNull()
      .references(() => runsTable.id),
    type: text("type").notNull(),
    eventKey: text("event_key").unique("idx_run_events_event_key"),
    data: text("data").notNull().default("{}"),
    ...createdAtColumn,
  },
  (table) => ({
    idxType: index("idx_run_events_type").on(table.type),
    idxRunTypeCreatedAt: index("idx_run_events_run_type_created_at").on(
      table.runId,
      table.type,
      table.createdAt,
    ),
    idxRun: index("idx_run_events_run_id").on(table.runId),
  }),
);

// 84. Run
const runsTable = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    requesterAccountId: text("requester_account_id").references(
      () => accounts.id,
    ),
    sessionId: text("session_id"),
    parentRunId: text("parent_run_id"),
    childThreadId: text("child_thread_id"),
    rootThreadId: text("root_thread_id"),
    rootRunId: text("root_run_id"),
    agentType: text("agent_type").notNull().default("default"),
    /** Immutable provider model resolved when this agent Run is created. */
    model: text("model"),
    status: text("status").notNull().default("queued"),
    lastEventId: integer("last_event_id").notNull().default(0),
    input: text("input").notNull().default("{}"),
    output: text("output"),
    error: text("error"),
    usage: text("usage").notNull().default("{}"),
    serviceId: text("service_id"),
    serviceHeartbeat: text("service_heartbeat"),
    leaseVersion: integer("lease_version").notNull().default(0),
    /** Unique marker for one lease-fenced atomic terminal commit. */
    completionKey: text("completion_key"),
    /** Exact immutable RunContext revision accepted for the next operation. */
    currentContextRevision: integer("current_context_revision"),
    /** Machine-readable terminal authority failure, separate from error text. */
    terminalReason: text("terminal_reason"),
    /** First thread-message sequence reserved by the atomic terminal commit. */
    transcriptSequenceStart: integer("transcript_sequence_start"),
    /** Opaque takos-agent-engine LoopState for lease-fenced crash recovery. */
    engineCheckpoint: text("engine_checkpoint"),
    engineCheckpointUpdatedAt: text("engine_checkpoint_updated_at"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    ...createdAtColumn,
  },
  (table) => ({
    idxService: index("idx_runs_service_id").on(table.serviceId),
    idxServiceHeartbeat: index("idx_runs_service_heartbeat").on(
      table.serviceHeartbeat,
    ),
    idxCompletionKey: index("idx_runs_completion_key").on(table.completionKey),
    idxThreadStatus: index("idx_runs_thread_status").on(
      table.threadId,
      table.status,
    ),
    idxThread: index("idx_runs_thread_id").on(table.threadId),
    idxStatus: index("idx_runs_status").on(table.status),
    idxSession: index("idx_runs_session_id").on(table.sessionId),
    idxRequester: index("idx_runs_requester_account_id").on(
      table.requesterAccountId,
    ),
    idxParentRun: index("idx_runs_parent_run_id").on(table.parentRunId),
    idxChildThread: index("idx_runs_child_thread_id").on(table.childThreadId),
    idxRootThread: index("idx_runs_root_thread_id").on(table.rootThreadId),
    idxRootRun: index("idx_runs_root_run_id").on(table.rootRunId),
    idxAgentType: index("idx_runs_agent_type").on(table.agentType),
    idxAccountStatus: index("idx_runs_account_status").on(
      table.accountId,
      table.status,
    ),
    idxAccountStatusCreatedAt: index("idx_runs_account_status_created_at").on(
      table.accountId,
      table.status,
      table.createdAt,
    ),
    idxAccount: index("idx_runs_account_id").on(table.accountId),
    idxAccountCreatedAt: index("idx_runs_account_created_at").on(
      table.accountId,
      table.createdAt,
    ),
  }),
);

export const runs = Object.assign(runsTable, {
  workerId: runsTable.serviceId,
  workerHeartbeat: runsTable.serviceHeartbeat,
});

/**
 * Immutable, derived transcript projections. `run_model_input` records the
 * exact provider-visible history pinned by one Run; `semantic_turn` shares the
 * same authority/deletion surface for the terminal recall cutover.
 */
export const turnProjectionRevisions = sqliteTable(
  "turn_projection_revisions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runsTable.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    projectionKind: text("projection_kind").notNull(),
    formatVersion: integer("format_version").notNull().default(1),
    algorithmRevision: text("algorithm_revision").notNull(),
    sourceStartSequence: integer("source_start_sequence").notNull(),
    sourceEndSequence: integer("source_end_sequence").notNull(),
    projectionDigest: text("projection_digest").notNull(),
    projectionJson: text("projection_json").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqRunKind: uniqueIndex(
      "turn_projection_revisions_account_id_run_id_projection_kind_unique",
    ).on(table.accountId, table.runId, table.projectionKind),
    uniqResourceDigest: uniqueIndex(
      "turn_projection_revisions_account_id_resource_id_projection_digest_unique",
    ).on(table.accountId, table.resourceId, table.projectionDigest),
    idxThreadKindSequence: index(
      "idx_turn_projection_revisions_thread_kind_sequence",
    ).on(
      table.accountId,
      table.threadId,
      table.projectionKind,
      table.sourceEndSequence,
    ),
    idxRunKind: index("idx_turn_projection_revisions_run_kind").on(
      table.runId,
      table.projectionKind,
    ),
  }),
);

/** Content-free Vectorize identities for canonical semantic projections. */
export const turnProjectionVectorRefs = sqliteTable(
  "turn_projection_vector_refs",
  {
    projectionId: text("projection_id")
      .notNull()
      .references(() => turnProjectionRevisions.id, { onDelete: "cascade" }),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    vectorId: text("vector_id").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkCount: integer("chunk_count").notNull(),
    chunkDigest: text("chunk_digest").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectionId, table.chunkIndex] }),
    uniqVectorId: uniqueIndex(
      "turn_projection_vector_refs_vector_id_unique",
    ).on(table.vectorId),
    idxAccount: index("idx_turn_projection_vector_refs_account_id").on(
      table.accountId,
      table.projectionId,
    ),
  }),
);

/**
 * Immutable, allowlisted permission and execution-budget snapshot for one Run.
 * Tool execution treats this immutable snapshot as an upper bound and still
 * intersects it with current Workspace policy. The broader context record
 * remains shadow-only until every control input is revisioned.
 */
export const runGrants = sqliteTable(
  "run_grants",
  {
    runId: text("run_id").primaryKey().references(() => runsTable.id),
    formatVersion: integer("format_version").notNull().default(1),
    principalId: text("principal_id").notNull().references(() => accounts.id),
    workspaceId: text("workspace_id").notNull().references(() => accounts.id),
    parentRunId: text("parent_run_id").references(() => runsTable.id),
    parentGrantDigest: text("parent_grant_digest"),
    enforcementMode: text("enforcement_mode").notNull().default("enforced"),
    grantJson: text("grant_json").notNull(),
    digest: text("digest").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    idxWorkspaceCreatedAt: index("idx_run_grants_workspace_created_at").on(
      table.workspaceId,
      table.createdAt,
    ),
    idxPrincipalCreatedAt: index("idx_run_grants_principal_created_at").on(
      table.principalId,
      table.createdAt,
    ),
    idxParentRun: index("idx_run_grants_parent_run_id").on(table.parentRunId),
  }),
);

/**
 * Append-only materialization identity for a Run. Revision 1 is committed with
 * the Run and RunGrant; later progressive activation appends new revisions.
 */
export const runContextRevisions = sqliteTable(
  "run_context_revisions",
  {
    runId: text("run_id").notNull().references(() => runsTable.id),
    revision: integer("revision").notNull(),
    parentRevision: integer("parent_revision"),
    activationEventId: integer("activation_event_id"),
    activationEventKey: text("activation_event_key"),
    formatVersion: integer("format_version").notNull().default(1),
    principalId: text("principal_id").notNull().references(() => accounts.id),
    workspaceId: text("workspace_id").notNull().references(() => accounts.id),
    threadId: text("thread_id").notNull().references(() => threads.id),
    transcriptCutSequence: integer("transcript_cut_sequence").notNull(),
    agentProfileRevision: text("agent_profile_revision").notNull(),
    modelRevision: text("model_revision").notNull(),
    systemPromptRevision: text("system_prompt_revision").notNull(),
    runGrantDigest: text("run_grant_digest").notNull(),
    recordMode: text("record_mode").notNull().default("shadow"),
    contextJson: text("context_json").notNull(),
    digest: text("digest").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.revision] }),
    idxWorkspaceCreatedAt: index(
      "idx_run_context_revisions_workspace_created_at",
    ).on(table.workspaceId, table.createdAt),
    idxThreadCreatedAt: index("idx_run_context_revisions_thread_created_at").on(
      table.threadId,
      table.createdAt,
    ),
    idxGrantDigest: index("idx_run_context_revisions_grant_digest").on(
      table.runGrantDigest,
    ),
    uniqActivationEventKey: uniqueIndex(
      "idx_run_context_revisions_activation_event_key",
    ).on(table.runId, table.activationEventKey),
  }),
);

/**
 * Immutable, content-free proof that one exact RunContext revision authorized
 * an outbound provider request. Request bodies and credentials stay out of the
 * Worker database; their stable digest is sufficient for replay prevention and
 * audit correlation.
 */
export const runModelCalls = sqliteTable(
  "run_model_calls",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull(),
    contextRevision: integer("context_revision").notNull(),
    contextDigest: text("context_digest").notNull(),
    runGrantDigest: text("run_grant_digest").notNull(),
    requestDigest: text("request_digest").notNull(),
    transportAttempt: integer("transport_attempt").notNull(),
    beginNonceDigest: text("begin_nonce_digest").notNull(),
    serviceId: text("service_id").notNull(),
    leaseVersion: integer("lease_version").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    revisionFk: foreignKey({
      columns: [table.runId, table.contextRevision],
      foreignColumns: [runContextRevisions.runId, runContextRevisions.revision],
      name: "run_model_calls_revision_fkey",
    }).onDelete("cascade"),
    uniqIdentity: uniqueIndex("idx_run_model_calls_identity").on(
      table.runId,
      table.contextRevision,
      table.requestDigest,
      table.transportAttempt,
    ),
    idxRunCreatedAt: index("idx_run_model_calls_run_created_at").on(
      table.runId,
      table.createdAt,
    ),
  }),
);

/** Secret-free provider transport meaning selected once for one Run. */
export const providerMaterializationRevisions = sqliteTable(
  "provider_materialization_revisions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runsTable.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    sourceKind: text("source_kind").notNull(),
    protocol: text("protocol").notNull(),
    endpoint: text("endpoint"),
    materializationDigest: text("materialization_digest").notNull(),
    materializationJson: text("materialization_json").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqRun: uniqueIndex("idx_provider_materialization_revisions_run").on(
      table.runId,
    ),
    uniqContent: uniqueIndex(
      "idx_provider_materialization_revisions_content",
    ).on(
      table.accountId,
      table.resourceId,
      table.materializationDigest,
    ),
  }),
);

/**
 * Normalized exact source identities for each immutable RunContext revision.
 * The context JSON is the digest-bearing replay record; this table is the
 * deletion/live-fence index and must be verified against that JSON on read.
 */
export const runContextResourceRefs = sqliteTable(
  "run_context_resource_refs",
  {
    runId: text("run_id").notNull(),
    contextRevision: integer("context_revision").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceKind: text("resource_kind").notNull(),
    resourceId: text("resource_id").notNull(),
    resourceDigest: text("resource_digest").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    pk: primaryKey({
      columns: [
        table.runId,
        table.contextRevision,
        table.resourceKind,
        table.resourceId,
      ],
    }),
    revisionFk: foreignKey({
      columns: [table.runId, table.contextRevision],
      foreignColumns: [runContextRevisions.runId, runContextRevisions.revision],
      name: "run_context_resource_refs_revision_fkey",
    }).onDelete("cascade"),
    idxResource: index("idx_run_context_resource_refs_resource").on(
      table.workspaceId,
      table.resourceKind,
      table.resourceId,
      table.runId,
      table.contextRevision,
    ),
  }),
);

/** Immutable, content-addressed native/MCP tool contract revision. */
export const toolDescriptorRevisions = sqliteTable(
  "tool_descriptor_revisions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    logicalName: text("logical_name").notNull(),
    source: text("source").notNull(),
    adapterReference: text("adapter_reference").notNull(),
    adapterRevision: text("adapter_revision").notNull(),
    schemaDigest: text("schema_digest").notNull(),
    descriptorDigest: text("descriptor_digest").notNull(),
    descriptorJson: text("descriptor_json").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqContent: uniqueIndex("idx_tool_descriptor_revisions_content").on(
      table.accountId,
      table.resourceId,
      table.descriptorDigest,
    ),
    idxLogicalName: index("idx_tool_descriptor_revisions_logical_name").on(
      table.accountId,
      table.logicalName,
      table.createdAt,
    ),
  }),
);

/** Exact ToolDescriptorRevision references carried by one RunContext. */
export const runContextToolDescriptorRefs = sqliteTable(
  "run_context_tool_descriptor_refs",
  {
    runId: text("run_id").notNull(),
    contextRevision: integer("context_revision").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    resourceDigest: text("resource_digest").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.runId, table.contextRevision, table.resourceId],
    }),
    revisionFk: foreignKey({
      columns: [table.runId, table.contextRevision],
      foreignColumns: [runContextRevisions.runId, runContextRevisions.revision],
      name: "run_context_tool_descriptor_refs_revision_fkey",
    }).onDelete("cascade"),
    idxResource: index("idx_run_context_tool_descriptor_refs_resource").on(
      table.workspaceId,
      table.resourceId,
      table.runId,
      table.contextRevision,
    ),
  }),
);

/** Exact ProviderMaterializationRevision carried by one RunContext. */
export const runContextProviderMaterializationRefs = sqliteTable(
  "run_context_provider_materialization_refs",
  {
    runId: text("run_id").notNull(),
    contextRevision: integer("context_revision").notNull(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    resourceDigest: text("resource_digest").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    pk: primaryKey({
      columns: [table.runId, table.contextRevision, table.resourceId],
    }),
    revisionFk: foreignKey({
      columns: [table.runId, table.contextRevision],
      foreignColumns: [runContextRevisions.runId, runContextRevisions.revision],
      name: "run_context_provider_materialization_refs_revision_fkey",
    }).onDelete("cascade"),
    resourceFk: foreignKey({
      columns: [table.workspaceId, table.resourceId, table.resourceDigest],
      foreignColumns: [
        providerMaterializationRevisions.accountId,
        providerMaterializationRevisions.resourceId,
        providerMaterializationRevisions.materializationDigest,
      ],
      name: "run_context_provider_materialization_refs_resource_fkey",
    }).onDelete("cascade"),
    idxResource: index(
      "idx_run_context_provider_materialization_refs_resource",
    ).on(
      table.workspaceId,
      table.resourceId,
      table.runId,
      table.contextRevision,
    ),
  }),
);

// 92. Immutable Skill content revision
export const skillRevisions = sqliteTable(
  "skill_revisions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    source: text("source").notNull(),
    skillId: text("skill_id").notNull(),
    contentDigest: text("content_digest").notNull(),
    contentJson: text("content_json").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqContent: uniqueIndex("idx_skill_revisions_content").on(
      table.accountId,
      table.resourceId,
      table.contentDigest,
    ),
    idxLogicalSkill: index("idx_skill_revisions_logical_skill").on(
      table.accountId,
      table.source,
      table.skillId,
      table.createdAt,
    ),
  }),
);

// 93. Immutable Skill resource revision
export const skillResourceRevisions = sqliteTable(
  "skill_resource_revisions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    skillRevisionId: text("skill_revision_id")
      .notNull()
      .references(() => skillRevisions.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    resourceKey: text("resource_key").notNull(),
    mediaType: text("media_type").notNull(),
    contentDigest: text("content_digest").notNull(),
    contentBytes: integer("content_bytes").notNull(),
    contentText: text("content_text").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    uniqKey: uniqueIndex("idx_skill_resource_revisions_key").on(
      table.skillRevisionId,
      table.resourceKey,
    ),
    uniqContent: uniqueIndex("idx_skill_resource_revisions_content").on(
      table.accountId,
      table.resourceId,
      table.contentDigest,
    ),
    idxSkill: index("idx_skill_resource_revisions_skill").on(
      table.accountId,
      table.skillRevisionId,
    ),
  }),
);

// 94. Immutable Run Skill-plan revision
export const runSkillPlanRevisions = sqliteTable(
  "run_skill_plan_revisions",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runsTable.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    resourceId: text("resource_id").notNull(),
    planDigest: text("plan_digest").notNull(),
    planJson: text("plan_json").notNull(),
    ...createdAtColumn,
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.revision] }),
    uniqResource: uniqueIndex("idx_run_skill_plan_revisions_resource").on(
      table.resourceId,
    ),
    idxAccountCreated: index("idx_run_skill_plan_revisions_account_created").on(
      table.accountId,
      table.createdAt,
    ),
  }),
);

// 95. Mutable custom Skill identity
export const skills = sqliteTable(
  "skills",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions").notNull(),
    triggers: text("triggers"),
    metadata: text("metadata").notNull().default("{}"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => ({
    uniqAccountName: uniqueIndex("idx_skills_account_name").on(
      table.accountId,
      table.name,
    ),
    idxEnabled: index("idx_skills_enabled").on(table.enabled),
    idxAccount: index("idx_skills_account_id").on(table.accountId),
  }),
);

// 95. ThreadShare
export const threadShares = sqliteTable(
  "thread_shares",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    createdByAccountId: text("created_by_account_id").references(
      () => accounts.id,
    ),
    token: text("token").notNull().unique(),
    mode: text("mode").notNull().default("public"),
    passwordHash: text("password_hash"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    lastAccessedAt: text("last_accessed_at"),
    ...createdAtColumn,
  },
  (table) => ({
    idxThread: index("idx_thread_shares_thread_id").on(table.threadId),
    idxExpiresAt: index("idx_thread_shares_expires_at").on(table.expiresAt),
    idxCreatedBy: index("idx_thread_shares_created_by_account_id").on(
      table.createdByAccountId,
    ),
    idxAccount: index("idx_thread_shares_account_id").on(table.accountId),
  }),
);

// 96. Thread
export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    title: text("title"),
    locale: text("locale"),
    status: text("status").notNull().default("active"),
    summary: text("summary"),
    keyPoints: text("key_points").notNull().default("[]"),
    retrievalIndex: integer("retrieval_index").notNull().default(-1),
    contextWindow: integer("context_window").notNull().default(50),
    /** Atomic allocator for message sequence ranges in this thread. */
    nextMessageSequence: integer("next_message_sequence").notNull().default(0),
    ...timestamps,
  },
  (table) => ({
    idxStatus: index("idx_threads_status").on(table.status),
    idxAccount: index("idx_threads_account_id").on(table.accountId),
  }),
);

// 97. ToolOperation (idempotent tool execution tracking)
export const toolOperations = sqliteTable(
  "tool_operations",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runsTable.id),
    operationKey: text("operation_key").notNull(),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull().default("pending"),
    resultOutput: text("result_output"),
    resultError: text("result_error"),
    ...createdAtColumn,
    completedAt: text("completed_at"),
  },
  (table) => ({
    uniqRunOpKey: uniqueIndex("idx_tool_operations_key").on(
      table.runId,
      table.operationKey,
    ),
    idxRunId: index("idx_tool_operations_run_id").on(table.runId),
  }),
);
