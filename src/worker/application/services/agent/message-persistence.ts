import type { Env, MessageRole } from "../../../shared/types/index.ts";
import type { AgentMessage } from "./agent-models.ts";
import { getDb, messages } from "../../../infra/db/index.ts";
import { eq, sql } from "drizzle-orm";
import { generateId } from "../../../shared/utils/index.ts";
import {
  makeMessagePreview,
  shouldOffloadMessage,
  writeMessageToR2,
} from "../offload/messages.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { reserveThreadMessageSequence } from "../threads/message-sequence.ts";

export interface MessagePersistenceDeps {
  db: SqlDatabaseBinding;
  env: Env;
  threadId: string;
}

function databaseErrorDetail(error: unknown): string {
  const details: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && !seen.has(current); depth++) {
    seen.add(current);
    if (current instanceof Error) {
      details.push(current.message);
      current = current.cause;
      continue;
    }
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (typeof record.message === "string") details.push(record.message);
      if (typeof record.code === "string") details.push(record.code);
      current = record.cause;
      continue;
    }
    details.push(String(current));
    break;
  }
  return details.join(" ");
}

function isUniqueConstraintError(detail: string): boolean {
  return /(?:unique|duplicate key|constraint|23505)/i.test(detail);
}

function isMessageSequenceConflict(detail: string): boolean {
  return (
    detail.includes("idx_messages_thread_sequence") ||
    /messages\.thread_id[^\n]*messages\.sequence/i.test(detail) ||
    /thread_id[^\n]*sequence/i.test(detail)
  );
}

function stableIdHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < value.length; i++) {
    hash ^= BigInt(value.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}

export async function persistMessage(
  deps: MessagePersistenceDeps,
  message: AgentMessage,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const { db: dbBinding, env, threadId } = deps;
  const db = getDb(dbBinding);
  const now = new Date().toISOString();
  const maxRetries = 16;
  const baseDelayMs = 5;
  const maxDelayMs = 100;

  const idempotencyKey =
    typeof metadata?.idempotencyKey === "string"
      ? metadata.idempotencyKey.trim()
      : "";
  const id = idempotencyKey
    ? `msg_idem_${stableIdHash(`${threadId}\0${idempotencyKey}`)}`
    : `msg_${stableIdHash(
        JSON.stringify({
          threadId,
          role: message.role,
          content: message.content?.slice(0, 1000),
          toolCalls: message.tool_calls
            ? JSON.stringify(message.tool_calls).slice(0, 500)
            : null,
          toolCallId: message.tool_call_id || null,
          timestamp: now.slice(0, 16),
        }),
      )}_${generateId(4)}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Idempotency: skip if a previous retry already inserted this message
      const existing = await db
        .select({
          id: messages.id,
        })
        .from(messages)
        .where(eq(messages.id, id))
        .get();

      if (existing) {
        // Message already exists (previous retry succeeded), skip
        return;
      }

      const reservedSequence = await reserveThreadMessageSequence(
        dbBinding,
        threadId,
      );
      const maxSeqResult =
        reservedSequence === null
          ? await db
              .select({
                maxSeq: sql<number>`max(${messages.sequence})`,
              })
              .from(messages)
              .where(eq(messages.threadId, threadId))
              .get()
          : null;
      const nextSequence = reservedSequence ?? (maxSeqResult?.maxSeq ?? -1) + 1;

      const toolCallsStr = message.tool_calls
        ? JSON.stringify(message.tool_calls)
        : null;
      const metadataStr = JSON.stringify(metadata || {});

      let r2Key: string | null = null;
      let contentForD1 = message.content;
      let toolCallsForD1: string | null = toolCallsStr;
      let metadataForD1 = metadataStr;

      const offloadBucket = env.TAKOS_OFFLOAD;
      if (
        offloadBucket &&
        shouldOffloadMessage({
          role: message.role as MessageRole,
          content: message.content,
        })
      ) {
        try {
          const { key } = await writeMessageToR2(offloadBucket, threadId, id, {
            id,
            thread_id: threadId,
            role: message.role as MessageRole,
            content: message.content,
            tool_calls: toolCallsStr,
            tool_call_id: message.tool_call_id || null,
            metadata: metadataStr,
            sequence: nextSequence,
            created_at: now,
          });
          r2Key = key;
          contentForD1 = makeMessagePreview(message.content);
          toolCallsForD1 = null;
          // Keep SQL store small; hydrate from object store on reads.
          metadataForD1 = "{}";
        } catch (err) {
          logWarn(
            `Failed to persist message ${id} to object store, storing inline`,
            {
              module: "message_offload",
              detail: err,
            },
          );
        }
      }

      await db.insert(messages).values({
        id,
        threadId,
        role: message.role,
        content: contentForD1,
        r2Key,
        toolCalls: toolCallsForD1,
        toolCallId: message.tool_call_id || null,
        metadata: metadataForD1,
        sequence: nextSequence,
        createdAt: now,
      });

      return; // Success
    } catch (error) {
      const errorMessage = databaseErrorDetail(error);

      if (isUniqueConstraintError(errorMessage)) {
        // Identify an idempotent duplicate by the actual primary-key row, not
        // by the substring "id" (which also appears in "thread_id").
        const inserted = await db
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.id, id))
          .get();
        if (inserted) return;
      }

      // Check if it's a sequence conflict (need to retry with new sequence)
      const isSequenceConflict = isMessageSequenceConflict(errorMessage);
      const isRetryable =
        isSequenceConflict ||
        /(?:SQLITE_BUSY|database is locked)/i.test(errorMessage);

      if (isRetryable && attempt < maxRetries - 1) {
        const exponentialDelay = Math.min(
          maxDelayMs,
          baseDelayMs * Math.pow(2, attempt),
        );
        const jitter = Math.random() * exponentialDelay;
        const totalDelay = Math.floor(exponentialDelay + jitter);

        if (attempt >= 2) {
          logWarn(
            `Message sequence conflict on attempt ${
              attempt + 1
            }/${maxRetries}, ` +
              `retrying in ${totalDelay}ms (thread: ${threadId})`,
            { module: "services/agent/message-persistence" },
          );
        }

        await new Promise((resolve) => setTimeout(resolve, totalDelay));
        continue;
      }

      if (attempt === maxRetries - 1) {
        logError(
          `Message insert failed after ${maxRetries} attempts: ${errorMessage}`,
          { threadId, role: message.role },
          { module: "services/agent/message-persistence" },
        );
      }

      throw error;
    }
  }

  throw new Error(
    `Failed to add message after ${maxRetries} attempts due to sequence conflicts. ` +
      `This may indicate very high concurrency on thread ${threadId}.`,
  );
}
