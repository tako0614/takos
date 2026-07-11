import { getDb, runEvents, runs } from "../../../infra/db/index.ts";
import { eq } from "drizzle-orm";
import type {
  ObjectStoreBinding,
  SqlDatabaseBinding,
  SqlPreparedStatementBinding,
  SqlResultBinding,
  SqlTransactionSessionBinding,
} from "../../../shared/types/bindings.ts";
import { affectedRowCount } from "../../../shared/utils/affected-row-count.ts";
import { computeSHA256 } from "../../../shared/utils/hash.ts";
import type { AgentMessage, AgentUsage } from "./agent-models.ts";
import {
  makeMessagePreview,
  messageR2Key,
  shouldOffloadMessage,
  writeMessageToR2,
} from "../offload/messages.ts";
import { buildTerminalIndexOutboxStatements } from "../run-notifier/index-outbox.ts";

export type CompleteRunStatus = "completed" | "failed";

export type CompleteRunMessage = AgentMessage & {
  metadata?: Record<string, unknown>;
};

export interface CompleteRunInput {
  runId: string;
  threadId: string;
  serviceId: string;
  leaseVersion: number;
  status: CompleteRunStatus;
  usage: AgentUsage;
  output?: string;
  error?: string;
  messages: CompleteRunMessage[];
  terminalEvent: Record<string, unknown>;
}

export interface CompleteRunStorage {
  offloadBucket?: ObjectStoreBinding;
  /** Checkpoint pointer observed immediately before this terminal CAS. */
  expectedEngineCheckpoint?: string | null;
}

export interface CompleteRunResult {
  committed: boolean;
  leaseLost: boolean;
  idempotent: boolean;
  eventId: number | null;
  completionKey: string;
}

type StatementFactory =
  | Pick<SqlDatabaseBinding, "prepare">
  | Pick<SqlTransactionSessionBinding, "prepare">;

type StoredCompletionMessage = {
  id: string;
  role: CompleteRunMessage["role"];
  content: string;
  r2Key: string | null;
  toolCalls: string | null;
  toolCallId: string | null;
  metadata: string;
  createdAt: string;
};

const MAX_INLINE_MESSAGE_BYTES = 256 * 1024;
const MAX_INLINE_TRANSCRIPT_BYTES = 1024 * 1024;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function completeRunKey(input: CompleteRunInput): Promise<string> {
  const digest = await computeSHA256(
    canonicalJson({
      runId: input.runId,
      threadId: input.threadId,
      serviceId: input.serviceId,
      leaseVersion: input.leaseVersion,
      status: input.status,
      usage: input.usage,
      output: input.output ?? null,
      error: input.error ?? null,
      messages: input.messages,
      terminalEvent: input.terminalEvent,
    }),
  );
  return `agent-complete:${digest}`;
}

function terminalEventKey(
  runId: string,
  completionKey: string,
  status: CompleteRunStatus,
): string {
  return `run:${runId}:completion:${completionKey}:terminal-status:${status}`;
}

function messageId(completionKey: string, index: number): string {
  return `msg_terminal_${completionKey.slice("agent-complete:".length)}_${index}`;
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function stageCompletionMessages(
  input: CompleteRunInput,
  completionKey: string,
  completedAt: string,
  bucket: ObjectStoreBinding | undefined,
): Promise<StoredCompletionMessage[]> {
  const stored: StoredCompletionMessage[] = [];
  let inlineTranscriptBytes = 0;

  try {
    for (let index = 0; index < input.messages.length; index++) {
      const message = input.messages[index];
      const id = messageId(completionKey, index);
      const toolCalls = message.tool_calls
        ? JSON.stringify(message.tool_calls)
        : null;
      const metadata = JSON.stringify({
        ...(message.metadata ?? {}),
        runId: input.runId,
        completionKey,
      });
      const inlineBytes =
        encodedBytes(message.content) +
        encodedBytes(toolCalls ?? "") +
        encodedBytes(metadata);
      const shouldOffload =
        shouldOffloadMessage({
          role: message.role,
          content: message.content,
        }) || inlineBytes > MAX_INLINE_MESSAGE_BYTES;

      if (shouldOffload && bucket) {
        const key = messageR2Key(input.threadId, id);
        const existedBeforeStage = Boolean(await bucket.head(key));
        if (!existedBeforeStage) {
          await writeMessageToR2(bucket, input.threadId, id, {
            id,
            thread_id: input.threadId,
            role: message.role,
            content: message.content,
            tool_calls: toolCalls,
            tool_call_id: message.tool_call_id ?? null,
            metadata,
            // The canonical sequence is assigned by the SQL transaction.
            // Hydration deliberately keeps the sequence from the SQL row.
            sequence: index,
            created_at: completedAt,
          });
        }
        stored.push({
          id,
          role: message.role,
          content: makeMessagePreview(message.content),
          r2Key: key,
          toolCalls: null,
          toolCallId: message.tool_call_id ?? null,
          metadata: "{}",
          createdAt: completedAt,
        });
        continue;
      }

      inlineTranscriptBytes += inlineBytes;
      if (
        inlineBytes > MAX_INLINE_MESSAGE_BYTES ||
        inlineTranscriptBytes > MAX_INLINE_TRANSCRIPT_BYTES
      ) {
        throw new Error(
          "complete_run_transcript_too_large: TAKOS_OFFLOAD is required for this transcript",
        );
      }
      stored.push({
        id,
        role: message.role,
        content: message.content,
        r2Key: null,
        toolCalls,
        toolCallId: message.tool_call_id ?? null,
        metadata,
        createdAt: completedAt,
      });
    }
  } catch (error) {
    // Do not delete after an ambiguous pre-stage failure: another identical
    // completion can concurrently reference the same content-addressed key.
    // Unreferenced objects are lifecycle-reapable; missing referenced objects
    // are not.
    throw error;
  }

  return stored;
}

function completionPredicateSql(alias: string): string {
  return `${alias}."id" = ? AND ${alias}."status" = ? AND ${alias}."service_id" = ? AND ${alias}."completion_key" = ? AND ${alias}."lease_version" = ?`;
}

function completionPredicateArgs(
  input: CompleteRunInput,
  completionKey: string,
): unknown[] {
  return [
    input.runId,
    input.status,
    input.serviceId,
    completionKey,
    input.leaseVersion,
  ];
}

function buildCompleteRunStatements(
  factory: StatementFactory,
  input: CompleteRunInput,
  storedMessages: StoredCompletionMessage[],
  completionKey: string,
  completedAt: string,
  expectedEngineCheckpoint: string | null | undefined,
): SqlPreparedStatementBinding[] {
  const usage = JSON.stringify(input.usage);
  const output = input.output ?? null;
  const error = input.error ?? null;
  const updateConditions = [
    '"id" = ?',
    "\"status\" = 'running'",
    '"service_id" = ?',
    '"lease_version" = ?',
  ];
  const updateArgs: unknown[] = [
    input.status,
    usage,
    output,
    error,
    completedAt,
    completionKey,
    input.runId,
    input.serviceId,
    input.leaseVersion,
  ];
  if (expectedEngineCheckpoint === null) {
    updateConditions.push('"engine_checkpoint" IS NULL');
  } else if (expectedEngineCheckpoint !== undefined) {
    updateConditions.push('"engine_checkpoint" = ?');
    updateArgs.push(expectedEngineCheckpoint);
  }
  const statements: SqlPreparedStatementBinding[] = [
    factory
      .prepare(
        `UPDATE "runs"
         SET "status" = ?, "usage" = ?, "output" = ?, "error" = ?,
             "completed_at" = ?, "completion_key" = ?,
             "engine_checkpoint" = NULL,
             "engine_checkpoint_updated_at" = NULL
         WHERE ${updateConditions.join(" AND ")}`,
      )
      .bind(...updateArgs),
  ];

  const predicate = completionPredicateSql("r");
  const predicateArgs = completionPredicateArgs(input, completionKey);
  if (storedMessages.length > 0) {
    // Reserve one contiguous sequence range while this terminal transaction
    // owns the thread row. Postgres row locking and D1's transactional batch
    // ensure that every other allocator observes the advanced counter only
    // after this whole transcript commits. Persisting the start on the Run
    // makes an identical complete-run retry idempotent: it cannot reserve a
    // second range after a commit-ambiguous response.
    statements.push(
      factory
        .prepare(
          `UPDATE "threads"
           SET "next_message_sequence" = "next_message_sequence" + ?
           WHERE "id" = (
             SELECT r."thread_id"
             FROM "runs" r
             WHERE ${predicate}
               AND r."transcript_sequence_start" IS NULL
           )
           RETURNING "next_message_sequence" - ? AS "start_sequence"`,
        )
        .bind(storedMessages.length, ...predicateArgs, storedMessages.length),
    );
    statements.push(
      factory
        .prepare(
          `UPDATE "runs"
           SET "transcript_sequence_start" = (
             SELECT t."next_message_sequence" - ?
             FROM "threads" t
             WHERE t."id" = "runs"."thread_id"
           )
           WHERE ${completionPredicateSql('"runs"')}
             AND "transcript_sequence_start" IS NULL`,
        )
        .bind(
          storedMessages.length,
          ...completionPredicateArgs(input, completionKey),
        ),
    );
  }
  // D1 allows 100 bound parameters/query and 50 queries/invocation on the
  // free tier. Ten rows use 90 row parameters plus the completion predicate,
  // keeping both limits bounded even for the accepted 256-message maximum.
  const MESSAGE_CHUNK_SIZE = 10;
  for (
    let chunkStart = 0;
    chunkStart < storedMessages.length;
    chunkStart += MESSAGE_CHUNK_SIZE
  ) {
    const chunk = storedMessages.slice(
      chunkStart,
      chunkStart + MESSAGE_CHUNK_SIZE,
    );
    const pendingRows = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");
    const pendingArgs: unknown[] = [];
    for (let offset = 0; offset < chunk.length; offset++) {
      const message = chunk[offset];
      pendingArgs.push(
        message.id,
        chunkStart + offset,
        message.role,
        message.content,
        message.r2Key,
        message.toolCalls,
        message.toolCallId,
        message.metadata,
        message.createdAt,
      );
    }
    statements.push(
      factory
        .prepare(
          `WITH pending
             ("id", "ord", "role", "content", "r2_key", "tool_calls",
              "tool_call_id", "metadata", "created_at") AS (
             VALUES ${pendingRows}
           )
           INSERT INTO "messages"
             ("id", "thread_id", "role", "content", "r2_key",
              "tool_calls", "tool_call_id", "metadata", "sequence", "created_at")
           SELECT p."id", r."thread_id", p."role", p."content", p."r2_key",
                  p."tool_calls", p."tool_call_id", p."metadata",
                  r."transcript_sequence_start" + CAST(p."ord" AS INTEGER),
                  p."created_at"
           FROM "runs" r
           CROSS JOIN pending p
           WHERE ${predicate}
             AND r."transcript_sequence_start" IS NOT NULL
           ORDER BY p."ord"
           ON CONFLICT ("id") DO NOTHING`,
        )
        .bind(...pendingArgs, ...predicateArgs),
    );
  }

  statements.push(
    ...buildTerminalIndexOutboxStatements(factory, {
      completionKey,
      createdAt: completedAt,
      runPredicateSql: predicate,
      runPredicateArgs: predicateArgs,
    }),
  );

  const eventType = input.status === "failed" ? "error" : input.status;
  statements.push(
    factory
      .prepare(
        `INSERT INTO "run_events"
           ("run_id", "type", "event_key", "data", "created_at")
         SELECT r."id", ?, ?, ?, ?
         FROM "runs" r
         WHERE ${predicate}
         ON CONFLICT ("event_key") DO NOTHING
         RETURNING "id"`,
      )
      .bind(
        eventType,
        terminalEventKey(input.runId, completionKey, input.status),
        JSON.stringify(input.terminalEvent),
        completedAt,
        ...predicateArgs,
      ),
  );
  return statements;
}

async function executeAtomicBatch(
  db: SqlDatabaseBinding,
  input: CompleteRunInput,
  storedMessages: StoredCompletionMessage[],
  completionKey: string,
  completedAt: string,
  expectedEngineCheckpoint: string | null | undefined,
): Promise<SqlResultBinding<Record<string, unknown>>[]> {
  if (db.withTransaction) {
    return await db.withTransaction(
      async (tx) =>
        await tx.batch<Record<string, unknown>>(
          buildCompleteRunStatements(
            tx,
            input,
            storedMessages,
            completionKey,
            completedAt,
            expectedEngineCheckpoint,
          ),
        ),
    );
  }
  // Cloudflare D1 batch is transactional: every statement commits or the whole
  // batch rolls back. Postgres adapters expose withTransaction above. The
  // conditional INSERT ... SELECT predicates additionally prevent orphan rows
  // when the leading lease/status CAS updates zero rows.
  return await db.batch<Record<string, unknown>>(
    buildCompleteRunStatements(
      db,
      input,
      storedMessages,
      completionKey,
      completedAt,
      expectedEngineCheckpoint,
    ),
  );
}

function eventIdFromBatch(
  results: SqlResultBinding<Record<string, unknown>>[],
): number | null {
  const row = results.at(-1)?.results[0];
  const id = row?.id;
  return typeof id === "number"
    ? id
    : typeof id === "string" && /^\d+$/u.test(id)
      ? Number(id)
      : null;
}

export async function completeRunAtomically(
  db: SqlDatabaseBinding,
  input: CompleteRunInput,
  storage: CompleteRunStorage = {},
): Promise<CompleteRunResult> {
  const completionKey = await completeRunKey(input);
  const completedAt = new Date().toISOString();
  const usage = JSON.stringify(input.usage);
  const output = input.output ?? null;
  const error = input.error ?? null;
  const stagedMessages = await stageCompletionMessages(
    input,
    completionKey,
    completedAt,
    storage.offloadBucket,
  );
  let results: SqlResultBinding<Record<string, unknown>>[];
  try {
    results = await executeAtomicBatch(
      db,
      input,
      stagedMessages,
      completionKey,
      completedAt,
      storage.expectedEngineCheckpoint,
    );
  } catch (error) {
    // A transport error may be commit-ambiguous. Never delete staged objects
    // until SQL proves that another outcome won the CAS.
    throw error;
  }
  if (affectedRowCount(results[0]) > 0) {
    return {
      committed: true,
      leaseLost: false,
      idempotent: false,
      eventId: eventIdFromBatch(results),
      completionKey,
    };
  }

  const current = await getDb(db)
    .select({
      status: runs.status,
      usage: runs.usage,
      output: runs.output,
      error: runs.error,
      serviceId: runs.serviceId,
      leaseVersion: runs.leaseVersion,
      completionKey: runs.completionKey,
    })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .get();
  const idempotent = Boolean(
    current &&
    current.status === input.status &&
    current.usage === usage &&
    current.output === output &&
    current.error === error &&
    current.serviceId === input.serviceId &&
    current.leaseVersion === input.leaseVersion &&
    current.completionKey === completionKey,
  );
  if (!idempotent) {
    return {
      committed: false,
      leaseLost: true,
      idempotent: false,
      eventId: null,
      completionKey,
    };
  }
  const existingEvent = await getDb(db)
    .select({ id: runEvents.id })
    .from(runEvents)
    .where(
      eq(
        runEvents.eventKey,
        terminalEventKey(input.runId, completionKey, input.status),
      ),
    )
    .get();
  return {
    committed: true,
    leaseLost: false,
    idempotent: true,
    eventId: existingEvent?.id ?? null,
    completionKey,
  };
}
