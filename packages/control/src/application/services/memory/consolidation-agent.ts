/**
 * Memory Consolidation Agent — Multi-agent wrapper for MemoryConsolidator.
 *
 * Wraps the existing MemoryConsolidator service as an independent background
 * agent that can be coordinated by the multi-agent framework. Supports
 * full consolidation, selective operations, and targeted messages for
 * decay-only or merge-only runs.
 */

import type { D1Database } from '../../../shared/types/bindings.ts';
import type {
  AgentWorkerConfig,
  AgentMessage,
} from '../multi-agent/types';
import { AbstractAgentWorker } from '../multi-agent/base-worker';
import { type MemoryConsolidator, createMemoryConsolidator } from './consolidation';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';

// ── Input / Output contracts ────────────────────────────────────────

export type ConsolidationOperation = 'decay' | 'merge' | 'summarize' | 'limit';

export interface ConsolidationInput {
  spaceId: string;
  apiKey?: string;
  /** Run only the listed operations. If omitted or empty, all operations run. */
  operations?: ConsolidationOperation[];
}

export interface ConsolidationOutput {
  decayed: { updated: number; deleted: number };
  merged: { merged: number };
  summarized: { summarized: number };
  limited: { deleted: number };
  spaceId: string;
}

// ── Message payloads ────────────────────────────────────────────────

interface ConsolidatePayload {
  spaceId: string;
  operations?: ConsolidationOperation[];
}

interface SingleOperationPayload {
  spaceId: string;
}

// ── Default (empty) results ─────────────────────────────────────────

const EMPTY_DECAY = { updated: 0, deleted: 0 } as const;
const EMPTY_MERGE = { merged: 0 } as const;
const EMPTY_SUMMARIZE = { summarized: 0 } as const;
const EMPTY_LIMIT = { deleted: 0 } as const;

// ── Agent implementation ────────────────────────────────────────────

/**
 * Runs memory consolidation as an autonomous agent worker.
 *
 * The agent wraps {@link MemoryConsolidator} so it can participate in
 * multi-agent workflows — receiving `consolidate`, `decay-only`, or
 * `merge-only` messages from an orchestrator. Each sub-operation is
 * retried independently via {@link AbstractAgentWorker.executeWithRetry}
 * so a partial failure (e.g. LLM timeout during merge) does not block
 * the remaining operations.
 */
export class MemoryConsolidationAgent extends AbstractAgentWorker<ConsolidationInput, ConsolidationOutput> {
  private db: D1Database | null = null;
  private consolidator: MemoryConsolidator | null = null;
  private apiKey: string | undefined;

  constructor(db: D1Database, apiKey?: string) {
    super('memory-consolidator');
    this.db = db;
    this.apiKey = apiKey;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /** @inheritdoc */
  protected async onInitialize(_config: AgentWorkerConfig): Promise<void> {
    if (!this.db) {
      throw new Error('MemoryConsolidationAgent requires a D1Database binding');
    }
    this.consolidator = createMemoryConsolidator(this.db, this.apiKey);
    logInfo('MemoryConsolidationAgent initialized', { module: 'memory/consolidation-agent' });
  }

  /** @inheritdoc */
  protected async onShutdown(): Promise<void> {
    this.consolidator = null;
    logInfo('MemoryConsolidationAgent shut down', { module: 'memory/consolidation-agent' });
  }

  // ── Primary execution ─────────────────────────────────────────

  /**
   * Run consolidation for a workspace.
   *
   * When `input.operations` is provided, only the listed operations
   * execute; otherwise all four operations run. Each operation uses
   * {@link AbstractAgentWorker.executeWithRetry} independently so a
   * transient failure in one operation does not prevent the others
   * from completing.
   */
  protected async onExecute(
    input: ConsolidationInput,
    signal?: AbortSignal,
  ): Promise<ConsolidationOutput> {
    this.ensureConsolidator();
    this.throwIfAborted(signal);

    const ops = new Set<ConsolidationOperation>(
      input.operations && input.operations.length > 0
        ? input.operations
        : ['decay', 'merge', 'summarize', 'limit'],
    );

    const decayed = ops.has('decay')
      ? await this.runOperation('decay', input.spaceId, signal)
      : { ...EMPTY_DECAY };

    const merged = ops.has('merge')
      ? await this.runOperation('merge', input.spaceId, signal)
      : { ...EMPTY_MERGE };

    const summarized = ops.has('summarize')
      ? await this.runOperation('summarize', input.spaceId, signal)
      : { ...EMPTY_SUMMARIZE };

    const limited = ops.has('limit')
      ? await this.runOperation('limit', input.spaceId, signal)
      : { ...EMPTY_LIMIT };

    logInfo(
      `Consolidation complete for space ${input.spaceId}: ` +
        `decay(upd=${decayed.updated},del=${decayed.deleted}), ` +
        `merge(${merged.merged}), summarize(${summarized.summarized}), ` +
        `limit(del=${limited.deleted})`,
      { module: 'memory/consolidation-agent' },
    );

    return { decayed, merged, summarized, limited, spaceId: input.spaceId };
  }

  // ── Message handling ──────────────────────────────────────────

  /** @inheritdoc */
  protected async onMessage(message: AgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'consolidate':
        return this.handleConsolidate(message.payload as ConsolidatePayload);

      case 'decay-only':
        return this.handleDecayOnly(message.payload as SingleOperationPayload);

      case 'merge-only':
        return this.handleMergeOnly(message.payload as SingleOperationPayload);

      default:
        return super.onMessage(message);
    }
  }

  /**
   * Handle a full (or selective) consolidation request.
   */
  private async handleConsolidate(payload: ConsolidatePayload): Promise<ConsolidationOutput> {
    return this.execute({
      spaceId: payload.spaceId,
      operations: payload.operations,
    });
  }

  /**
   * Handle a decay-only request.
   */
  private async handleDecayOnly(
    payload: SingleOperationPayload,
  ): Promise<{ decayed: { updated: number; deleted: number }; spaceId: string }> {
    this.ensureConsolidator();
    const decayed = await this.runOperation('decay', payload.spaceId);
    return { decayed, spaceId: payload.spaceId };
  }

  /**
   * Handle a merge-only request.
   */
  private async handleMergeOnly(
    payload: SingleOperationPayload,
  ): Promise<{ merged: { merged: number }; spaceId: string }> {
    this.ensureConsolidator();
    const merged = await this.runOperation('merge', payload.spaceId);
    return { merged, spaceId: payload.spaceId };
  }

  // ── Operation runner ──────────────────────────────────────────

  /**
   * Execute a single consolidation operation with independent retry.
   *
   * Failures are caught and logged so they do not cascade into
   * subsequent operations.
   */
  private async runOperation(
    op: 'decay',
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<{ updated: number; deleted: number }>;
  private async runOperation(
    op: 'merge',
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<{ merged: number }>;
  private async runOperation(
    op: 'summarize',
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<{ summarized: number }>;
  private async runOperation(
    op: 'limit',
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<{ deleted: number }>;
  private async runOperation(
    op: ConsolidationOperation,
    spaceId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, number>> {
    this.throwIfAborted(signal);

    try {
      return await this.executeWithRetry(async (_attempt) => {
        this.throwIfAborted(signal);

        switch (op) {
          case 'decay':
            return this.consolidator!.applyDecay(spaceId);
          case 'merge':
            return this.consolidator!.mergeSimilar(spaceId);
          case 'summarize':
            return this.consolidator!.summarizeOld(spaceId);
          case 'limit':
            return this.consolidator!.enforceLimit(spaceId);
        }
      });
    } catch (err) {
      logError(`Consolidation operation '${op}' failed for space ${spaceId}`, err, {
        module: 'memory/consolidation-agent',
      });

      // Return safe defaults so the remaining operations can continue.
      switch (op) {
        case 'decay':
          return { ...EMPTY_DECAY };
        case 'merge':
          return { ...EMPTY_MERGE };
        case 'summarize':
          return { ...EMPTY_SUMMARIZE };
        case 'limit':
          return { ...EMPTY_LIMIT };
      }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Guard that throws if the consolidator has not been initialised.
   */
  private ensureConsolidator(): void {
    if (!this.consolidator) {
      throw new Error(
        'MemoryConsolidationAgent has not been initialized. Call initialize() first.',
      );
    }
  }
}

/**
 * Factory function matching the project convention for service creation.
 */
export function createMemoryConsolidationAgent(
  db: D1Database,
  apiKey?: string,
): MemoryConsolidationAgent {
  return new MemoryConsolidationAgent(db, apiKey);
}
