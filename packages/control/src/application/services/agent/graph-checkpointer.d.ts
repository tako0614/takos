/**
 * D1 Checkpoint Saver for LangGraph
 *
 * Persists LangGraph checkpoints and pending writes to D1 (Cloudflare SQL).
 */
import { BaseCheckpointSaver, type Checkpoint, type CheckpointMetadata, type CheckpointTuple, type PendingWrite, type ChannelVersions } from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
export declare function toBase64(u8: Uint8Array): string;
export declare function fromBase64(s: string): Uint8Array;
/**
 * D1 Checkpoint Saver for LangGraph
 */
export declare class D1CheckpointSaver extends BaseCheckpointSaver<number> {
    private db;
    constructor(db: SqlDatabaseBinding);
    /** Delete all checkpoints and writes for a thread. */
    deleteThread(threadId: string): Promise<void>;
    /**
     * Attempt to recover from checkpoint corruption.
     * Identifies and removes corrupted pending writes, or resets to parent checkpoint
     * if the core checkpoint data itself is corrupted.
     */
    recoverCorruptedCheckpoint(threadId: string, checkpointNs?: string, checkpointId?: string): Promise<{
        recovered: boolean;
        cleanedWrites: number;
        resetToParent: boolean;
        error?: string;
    }>;
    /** Validate that the parent checkpoint exists and belongs to the same thread. */
    private validateAncestry;
    /** Save a checkpoint. Validates ancestry before saving. */
    put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata, _newVersions: ChannelVersions): Promise<RunnableConfig<Record<string, any>>>;
    /** Save pending writes for a checkpoint. */
    putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void>;
    /** Get a checkpoint tuple by config. */
    getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined>;
    /** List checkpoints for a thread. The limit parameter is validated and bounded. */
    list(config: RunnableConfig, options?: {
        limit?: number;
        before?: RunnableConfig;
    }): AsyncGenerator<CheckpointTuple>;
}
//# sourceMappingURL=graph-checkpointer.d.ts.map