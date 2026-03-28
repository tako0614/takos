import type { Env, MessageRole } from '../../../shared/types';
import type { AgentMessage } from './agent-models';
import { getDb, messages } from '../../../infra/db';
import { eq, sql } from 'drizzle-orm';
import { generateId } from '../../../shared/utils';
import { makeMessagePreview, shouldOffloadMessage, writeMessageToR2 } from '../offload/messages';
import { logError, logWarn } from '../../../shared/utils/logger';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';

export interface MessagePersistenceDeps {
  db: SqlDatabaseBinding;
  env: Env;
  threadId: string;
}

export async function persistMessage(
  deps: MessagePersistenceDeps,
  message: AgentMessage,
  metadata?: Record<string, unknown>
): Promise<void> {
  const { db: dbBinding, env, threadId } = deps;
  const db = getDb(dbBinding);
  const now = new Date().toISOString();
  const maxRetries = 5;
  const baseDelayMs = 10;
  const maxDelayMs = 500;

  // Deterministic ID based on content hash for idempotency across retries
  const contentForHash = JSON.stringify({
    threadId,
    role: message.role,
    content: message.content?.slice(0, 1000), // Use first 1000 chars for uniqueness
    toolCalls: message.tool_calls ? JSON.stringify(message.tool_calls).slice(0, 500) : null,
    toolCallId: message.tool_call_id || null,
    timestamp: now.slice(0, 16), // Use timestamp to minute precision for grouping
  });

  let hash = 0;
  for (let i = 0; i < contentForHash.length; i++) {
    const char = contentForHash.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const idBase = Math.abs(hash).toString(36);
  const randomSuffix = generateId(4);
  const id = `msg_${idBase}_${randomSuffix}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Idempotency: skip if a previous retry already inserted this message
      const existing = await db.select({
        id: messages.id,
      }).from(messages).where(eq(messages.id, id)).get();

      if (existing) {
        // Message already exists (previous retry succeeded), skip
        return;
      }

      // Get max sequence
      const maxSeqResult = await db.select({
        maxSeq: sql<number>`max(${messages.sequence})`,
      }).from(messages).where(eq(messages.threadId, threadId)).get();

      const nextSequence = (maxSeqResult?.maxSeq ?? -1) + 1;

      const toolCallsStr = message.tool_calls ? JSON.stringify(message.tool_calls) : null;
      const metadataStr = JSON.stringify(metadata || {});

      let r2Key: string | null = null;
      let contentForD1 = message.content;
      let toolCallsForD1: string | null = toolCallsStr;
      let metadataForD1 = metadataStr;

      const offloadBucket = env.TAKOS_OFFLOAD;
      if (offloadBucket && shouldOffloadMessage({ role: message.role as MessageRole, content: message.content })) {
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
          // Keep D1 small; hydrate from R2 on reads.
          metadataForD1 = '{}';
        } catch (err) {
          logWarn(`Failed to persist message ${id} to R2, storing inline`, { module: 'message_offload', detail: err });
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
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Duplicate ID means a previous retry already succeeded
      if (errorMessage.includes('UNIQUE constraint') && errorMessage.includes('id')) {
        return;
      }

      // Check if it's a sequence conflict (need to retry with new sequence)
      const isSequenceConflict = errorMessage.includes('UNIQUE constraint');
      const isRetryable = isSequenceConflict || errorMessage.includes('SQLITE_BUSY');

      if (isRetryable && attempt < maxRetries - 1) {
        const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
        const jitter = Math.random() * exponentialDelay;
        const totalDelay = Math.floor(exponentialDelay + jitter);

        if (attempt >= 2) {
          logWarn(`Message sequence conflict on attempt ${attempt + 1}/${maxRetries}, ` +
            `retrying in ${totalDelay}ms (thread: ${threadId})`, { module: 'services/agent/message-persistence' });
        }

        await new Promise(resolve => setTimeout(resolve, totalDelay));
        continue;
      }

      if (attempt === maxRetries - 1) {
        logError(`Message insert failed after ${maxRetries} attempts: ${errorMessage}`, { threadId, role: message.role }, { module: 'services/agent/message-persistence' });
      }

      throw error;
    }
  }

  throw new Error(
    `Failed to add message after ${maxRetries} attempts due to sequence conflicts. ` +
    `This may indicate very high concurrency on thread ${threadId}.`
  );
}
