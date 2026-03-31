/**
 * D1 Checkpoint Saver for LangGraph
 *
 * Persists LangGraph checkpoints and pending writes to D1 (Cloudflare SQL).
 */

import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
  type ChannelVersions,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { BadRequestError, InternalError } from 'takos-common/errors';
import { getDb, lgCheckpoints, lgWrites } from '../../../infra/db/index.ts';
import { eq, and, lt, desc } from 'drizzle-orm';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger.ts';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import { textDateNullable } from '../../../shared/utils/db-guards.ts';

// ── Internal helpers ─────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown error. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MIN_CHECKPOINT_LIMIT = 1;
const MAX_CHECKPOINT_LIMIT = 1000;
const DEFAULT_CHECKPOINT_LIMIT = 50;

/** Validate and bound the limit parameter to a safe integer range. */
function validateLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || !Number.isFinite(limit)) {
    return DEFAULT_CHECKPOINT_LIMIT;
  }
  return Math.max(MIN_CHECKPOINT_LIMIT, Math.min(MAX_CHECKPOINT_LIMIT, limit));
}

interface LangGraphConfigurable {
  thread_id?: string;
  checkpoint_ns?: string;
  checkpoint_id?: string;
  session_id?: string;
  snapshot_id?: string;
}

interface ConfigurableRunnableConfig extends RunnableConfig {
  configurable?: LangGraphConfigurable;
}

function hasConfigurable(config: RunnableConfig): config is ConfigurableRunnableConfig {
  return config != null && typeof config === 'object' && 'configurable' in config;
}

function getConfigurable(config: RunnableConfig): LangGraphConfigurable {
  if (hasConfigurable(config) && config.configurable) {
    return config.configurable;
  }
  return {};
}

export function toBase64(u8: Uint8Array): string {
  let s = '';
  for (const c of u8) s += String.fromCharCode(c);
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

function getThreadConfig(config: RunnableConfig): {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string | null;
  session_id: string | null;
  snapshot_id: string | null;
} {
  const c = getConfigurable(config);
  const thread_id = c.thread_id;
  if (!thread_id) throw new BadRequestError('configurable.thread_id is required');
  const checkpoint_ns = c.checkpoint_ns ?? '';
  const checkpoint_id = c.checkpoint_id ?? null;
  const session_id = c.session_id ?? null;
  const snapshot_id = c.snapshot_id ?? null;
  return { thread_id, checkpoint_ns, checkpoint_id, session_id, snapshot_id };
}

// ── D1CheckpointSaver ─────────────────────────────────────────────────

/**
 * D1 Checkpoint Saver for LangGraph
 */
export class D1CheckpointSaver extends BaseCheckpointSaver<number> {
  constructor(private db: SqlDatabaseBinding) {
    super();
  }

  /** Delete all checkpoints and writes for a thread. */
  async deleteThread(threadId: string): Promise<void> {
    try {
      const db = getDb(this.db);
      await db.delete(lgWrites).where(eq(lgWrites.threadId, threadId));
      await db.delete(lgCheckpoints).where(eq(lgCheckpoints.threadId, threadId));
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new InternalError(`Failed to delete thread checkpoints: ${errorMsg}`);
    }
  }

  /**
   * Attempt to recover from checkpoint corruption.
   * Identifies and removes corrupted pending writes, or resets to parent checkpoint
   * if the core checkpoint data itself is corrupted.
   */
  async recoverCorruptedCheckpoint(
    threadId: string,
    checkpointNs: string = '',
    checkpointId?: string
  ): Promise<{
    recovered: boolean;
    cleanedWrites: number;
    resetToParent: boolean;
    error?: string;
  }> {
    try {
      const db = getDb(this.db);

      const row = checkpointId
        ? await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, threadId),
              eq(lgCheckpoints.checkpointNs, checkpointNs),
              eq(lgCheckpoints.checkpointId, checkpointId),
            )
          ).get()
        : await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, threadId),
              eq(lgCheckpoints.checkpointNs, checkpointNs),
            )
          ).orderBy(desc(lgCheckpoints.ts)).get();

      if (!row) {
        return { recovered: false, cleanedWrites: 0, resetToParent: false, error: 'Checkpoint not found' };
      }

      try {
        await this.serde.loadsTyped(row.checkpointType, fromBase64(row.checkpointData));
      } catch {
        logError(`Core checkpoint ${row.checkpointId} is corrupted, resetting to parent`, undefined, { module: 'd1checkpointer' });

        if (row.parentCheckpointId) {
          // Delete this corrupted checkpoint and its writes
          await db.delete(lgWrites).where(
            and(
              eq(lgWrites.threadId, threadId),
              eq(lgWrites.checkpointId, row.checkpointId),
            )
          );
          await db.delete(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, threadId),
              eq(lgCheckpoints.checkpointNs, checkpointNs),
              eq(lgCheckpoints.checkpointId, row.checkpointId),
            )
          );

          return {
            recovered: true,
            cleanedWrites: 0,
            resetToParent: true,
            error: `Corrupted checkpoint deleted, will resume from parent: ${row.parentCheckpointId}`,
          };
        } else {
          return {
            recovered: false,
            cleanedWrites: 0,
            resetToParent: false,
            error: 'Root checkpoint is corrupted and cannot be recovered',
          };
        }
      }

      const writes = await db.select({
        taskId: lgWrites.taskId,
        channel: lgWrites.channel,
        valueType: lgWrites.valueType,
        valueData: lgWrites.valueData,
      }).from(lgWrites).where(
        and(
          eq(lgWrites.threadId, threadId),
          eq(lgWrites.checkpointNs, checkpointNs),
          eq(lgWrites.checkpointId, row.checkpointId),
        )
      ).all();

      const corruptedWrites: Array<{ taskId: string; channel: string }> = [];

      for (const w of writes) {
        try {
          await this.serde.loadsTyped(w.valueType, fromBase64(w.valueData));
        } catch {
          corruptedWrites.push({ taskId: w.taskId, channel: w.channel });
        }
      }

      if (corruptedWrites.length === 0) {
        return { recovered: true, cleanedWrites: 0, resetToParent: false };
      }

      for (const write of corruptedWrites) {
        await db.delete(lgWrites).where(
          and(
            eq(lgWrites.threadId, threadId),
            eq(lgWrites.checkpointNs, checkpointNs),
            eq(lgWrites.checkpointId, row.checkpointId),
            eq(lgWrites.taskId, write.taskId),
            eq(lgWrites.channel, write.channel),
          )
        );
      }

      logInfo(`Recovered checkpoint ${row.checkpointId}: ` +
        `deleted ${corruptedWrites.length} corrupted writes from channels: ${corruptedWrites.map(w => w.channel).join(', ')}`, { module: 'd1checkpointer' });

      return {
        recovered: true,
        cleanedWrites: corruptedWrites.length,
        resetToParent: false,
      };
    } catch (error) {
      const errorMsg = errorMessage(error);
      return {
        recovered: false,
        cleanedWrites: 0,
        resetToParent: false,
        error: `Recovery failed: ${errorMsg}`,
      };
    }
  }

  /** Validate that the parent checkpoint exists and belongs to the same thread. */
  private async validateAncestry(
    threadId: string,
    checkpointNs: string,
    parentCheckpointId: string | null
  ): Promise<{ valid: boolean; error?: string }> {
    if (!parentCheckpointId) return { valid: true };

    try {
      const db = getDb(this.db);
      const parent = await db.select({
        checkpointId: lgCheckpoints.checkpointId,
        threadId: lgCheckpoints.threadId,
        checkpointNs: lgCheckpoints.checkpointNs,
      }).from(lgCheckpoints).where(
        and(
          eq(lgCheckpoints.threadId, threadId),
          eq(lgCheckpoints.checkpointNs, checkpointNs),
          eq(lgCheckpoints.checkpointId, parentCheckpointId),
        )
      ).get();

      if (!parent) {
        return {
          valid: false,
          error: `Parent checkpoint ${parentCheckpointId} not found for thread ${threadId}`,
        };
      }

      if (parent.threadId !== threadId || parent.checkpointNs !== checkpointNs) {
        return {
          valid: false,
          error: `Parent checkpoint ${parentCheckpointId} belongs to different thread/namespace`,
        };
      }

      return { valid: true };
    } catch (error) {
      const errorMsg = errorMessage(error);
      return { valid: false, error: `Ancestry validation failed: ${errorMsg}` };
    }
  }

  /** Save a checkpoint. Validates ancestry before saving. */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig<Record<string, any>>> {
    const { thread_id, checkpoint_ns, session_id, snapshot_id } = getThreadConfig(config);
    const configurable = getConfigurable(config);
    const parent_checkpoint_id = configurable.checkpoint_id ?? null;

    try {
      const db = getDb(this.db);

      const ancestryResult = await this.validateAncestry(thread_id, checkpoint_ns, parent_checkpoint_id);
      if (!ancestryResult.valid) {
        logWarn(`Ancestry validation warning: ${ancestryResult.error}`, { module: 'd1checkpointer' });
      }

      const [ckType, ckBytes] = await this.serde.dumpsTyped(checkpoint);
      const [mdType, mdBytes] = await this.serde.dumpsTyped(metadata);

      const data = {
        threadId: thread_id,
        checkpointNs: checkpoint_ns,
        checkpointId: checkpoint.id,
        parentCheckpointId: parent_checkpoint_id,
        ts: checkpoint.ts,
        checkpointType: ckType,
        checkpointData: toBase64(new Uint8Array(ckBytes)),
        metadataType: mdType,
        metadataData: toBase64(new Uint8Array(mdBytes)),
        sessionId: session_id,
        snapshotId: snapshot_id,
      };

      await db.insert(lgCheckpoints).values(data).onConflictDoUpdate({
        target: [lgCheckpoints.threadId, lgCheckpoints.checkpointNs, lgCheckpoints.checkpointId],
        set: {
          parentCheckpointId: parent_checkpoint_id,
          ts: checkpoint.ts,
          checkpointType: ckType,
          checkpointData: toBase64(new Uint8Array(ckBytes)),
          metadataType: mdType,
          metadataData: toBase64(new Uint8Array(mdBytes)),
          sessionId: session_id,
          snapshotId: snapshot_id,
        },
      });

      return {
        ...config,
        configurable: {
          ...configurable,
          thread_id,
          checkpoint_ns,
          checkpoint_id: checkpoint.id,
          session_id,
          snapshot_id,
        },
      };
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new InternalError(`Failed to save checkpoint: ${errorMsg}`);
    }
  }

  /** Save pending writes for a checkpoint. */
  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const { thread_id, checkpoint_ns, checkpoint_id } = getThreadConfig(config);
    if (!checkpoint_id) throw new BadRequestError('configurable.checkpoint_id is required for putWrites');

    try {
      const db = getDb(this.db);

      for (const [channel, value] of writes) {
        const [vType, vBytes] = await this.serde.dumpsTyped(value);

        await db.insert(lgWrites).values({
          threadId: thread_id,
          checkpointNs: checkpoint_ns,
          checkpointId: checkpoint_id,
          taskId,
          channel: String(channel),
          valueType: vType,
          valueData: toBase64(new Uint8Array(vBytes)),
        }).onConflictDoUpdate({
          target: [lgWrites.threadId, lgWrites.checkpointNs, lgWrites.checkpointId, lgWrites.taskId, lgWrites.channel],
          set: {
            valueType: vType,
            valueData: toBase64(new Uint8Array(vBytes)),
          },
        });
      }
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new InternalError(`Failed to save pending writes: ${errorMsg}`);
    }
  }

  /** Get a checkpoint tuple by config. */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id, checkpoint_ns, checkpoint_id } = getThreadConfig(config);

    try {
      const db = getDb(this.db);

      const row = checkpoint_id
        ? await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, thread_id),
              eq(lgCheckpoints.checkpointNs, checkpoint_ns),
              eq(lgCheckpoints.checkpointId, checkpoint_id),
            )
          ).get()
        : await db.select().from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, thread_id),
              eq(lgCheckpoints.checkpointNs, checkpoint_ns),
            )
          ).orderBy(desc(lgCheckpoints.ts)).get();

      if (!row) return undefined;

      const checkpoint = await this.serde.loadsTyped(
        row.checkpointType,
        fromBase64(row.checkpointData)
      ) as Checkpoint;

      const metadata = row.metadataType && row.metadataData
        ? (await this.serde.loadsTyped(row.metadataType, fromBase64(row.metadataData)) as CheckpointMetadata)
        : undefined;

      const writes = await db.select({
        taskId: lgWrites.taskId,
        channel: lgWrites.channel,
        valueType: lgWrites.valueType,
        valueData: lgWrites.valueData,
      }).from(lgWrites).where(
        and(
          eq(lgWrites.threadId, thread_id),
          eq(lgWrites.checkpointNs, checkpoint_ns),
          eq(lgWrites.checkpointId, checkpoint.id),
        )
      ).all();

      const pendingWrites: [string, string, unknown][] = [];
      let corruptedWriteCount = 0;
      const corruptedChannels: string[] = [];

      for (const w of writes) {
        try {
          const val = await this.serde.loadsTyped(w.valueType, fromBase64(w.valueData));
          pendingWrites.push([w.taskId, w.channel, val]);
        } catch (writeError) {
          corruptedWriteCount++;
          corruptedChannels.push(w.channel);
          logWarn(`Failed to deserialize pending write for channel ${w.channel}`, { module: 'services/agent/d1-checkpointer', detail: writeError });
        }
      }

      if (corruptedWriteCount > 0) {
        logError(`Checkpoint ${checkpoint.id} has ${corruptedWriteCount} corrupted pending writes. ` +
          `Affected channels: ${corruptedChannels.join(', ')}. ` +
          `This may indicate data corruption and could affect agent state consistency.`, undefined, { module: 'd1checkpointer' });
      }

      const configurable = getConfigurable(config);

      const enhancedMetadata = corruptedWriteCount > 0
        ? {
            ...metadata,
            _checkpointWarning: {
              corruptedWriteCount,
              corruptedChannels,
              message: 'Some pending writes could not be deserialized',
            },
          }
        : metadata;

      return {
        checkpoint,
        config: {
          ...config,
          configurable: {
            ...configurable,
            thread_id,
            checkpoint_ns,
            checkpoint_id: checkpoint.id,
          },
        },
        metadata: enhancedMetadata as CheckpointMetadata,
        parentConfig: row.parentCheckpointId
          ? { configurable: { thread_id, checkpoint_ns, checkpoint_id: row.parentCheckpointId } }
          : undefined,
        pendingWrites,
      };
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new InternalError(`Failed to get checkpoint tuple: ${errorMsg}`);
    }
  }

  /** List checkpoints for a thread. The limit parameter is validated and bounded. */
  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig }
  ): AsyncGenerator<CheckpointTuple> {
    const { thread_id, checkpoint_ns } = getThreadConfig(config);
    const limit = validateLimit(options?.limit);

    try {
      const db = getDb(this.db);

      let beforeTs: string | undefined;

      if (options?.before) {
        const beforeConfig = getThreadConfig(options.before);
        if (beforeConfig.checkpoint_id) {
          const beforeRow = await db.select({
            ts: lgCheckpoints.ts,
          }).from(lgCheckpoints).where(
            and(
              eq(lgCheckpoints.threadId, thread_id),
              eq(lgCheckpoints.checkpointNs, checkpoint_ns),
              eq(lgCheckpoints.checkpointId, beforeConfig.checkpoint_id),
            )
          ).get();

          if (beforeRow) {
            beforeTs = textDateNullable(beforeRow.ts) ?? undefined;
          }
        }
      }

      const conditions = [
        eq(lgCheckpoints.threadId, thread_id),
        eq(lgCheckpoints.checkpointNs, checkpoint_ns),
      ];
      if (beforeTs) {
        conditions.push(lt(lgCheckpoints.ts, beforeTs));
      }

      const rows = await db.select().from(lgCheckpoints)
        .where(and(...conditions))
        .orderBy(desc(lgCheckpoints.ts))
        .limit(limit)
        .all();

      for (const row of rows) {
        try {
          const tuple = await this.getTuple({
            configurable: { thread_id, checkpoint_ns, checkpoint_id: row.checkpointId },
          } as RunnableConfig);
          if (tuple) yield tuple;
        } catch (tupleError) {
          logWarn(`Failed to get tuple for checkpoint ${row.checkpointId}`, { module: 'services/agent/d1-checkpointer', detail: tupleError });
        }
      }
    } catch (error) {
      const errorMsg = errorMessage(error);
      throw new InternalError(`Failed to list checkpoints: ${errorMsg}`);
    }
  }
}
