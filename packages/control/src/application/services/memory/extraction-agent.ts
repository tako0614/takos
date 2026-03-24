/**
 * Memory Extraction Agent — Multi-agent wrapper for MemoryExtractor.
 *
 * Wraps the existing MemoryExtractor service as an independent background
 * agent that can be coordinated by the multi-agent framework. Supports
 * single-thread and batch extraction via message passing.
 */

import type { D1Database } from '../../../shared/types/bindings.ts';
import type {
  AgentWorkerConfig,
  AgentMessage,
} from '../multi-agent/types';
import { AbstractAgentWorker } from '../multi-agent/base-worker';
import { type MemoryExtractor, createMemoryExtractor } from './extractor';
import { logError, logInfo } from '../../../shared/utils/logger';

// ── Input / Output contracts ────────────────────────────────────────

export interface ExtractionInput {
  spaceId: string;
  threadId: string;
  userId: string;
  apiKey?: string;
}

export interface ExtractionOutput {
  extracted: number;
  saved: number;
  threadId: string;
}

// ── Message payloads ────────────────────────────────────────────────

interface ExtractThreadPayload {
  spaceId: string;
  threadId: string;
  userId: string;
}

interface BatchExtractPayload {
  spaceId: string;
  threads: Array<{ threadId: string; userId: string }>;
}

// ── Agent implementation ────────────────────────────────────────────

/**
 * Runs memory extraction as an autonomous agent worker.
 *
 * The agent wraps {@link MemoryExtractor} so it can participate in
 * multi-agent workflows — receiving `extract-thread` or `batch-extract`
 * messages from an orchestrator while automatically handling retries
 * and abort signals via the base class.
 */
export class MemoryExtractionAgent extends AbstractAgentWorker<ExtractionInput, ExtractionOutput> {
  private db: D1Database | null = null;
  private extractor: MemoryExtractor | null = null;
  private apiKey: string | undefined;

  constructor(db: D1Database, apiKey?: string) {
    super('memory-extractor');
    this.db = db;
    this.apiKey = apiKey;
  }

  // ── Lifecycle ──────────────────────────────────────────────────

  /** @inheritdoc */
  protected async onInitialize(_config: AgentWorkerConfig): Promise<void> {
    if (!this.db) {
      throw new Error('MemoryExtractionAgent requires a D1Database binding');
    }
    this.extractor = createMemoryExtractor(this.db, this.apiKey);
    logInfo('MemoryExtractionAgent initialized', { module: 'memory/extraction-agent' });
  }

  /** @inheritdoc */
  protected async onShutdown(): Promise<void> {
    this.extractor = null;
    logInfo('MemoryExtractionAgent shut down', { module: 'memory/extraction-agent' });
  }

  // ── Primary execution ─────────────────────────────────────────

  /**
   * Extract and persist memories from a single thread.
   *
   * Uses {@link AbstractAgentWorker.executeWithRetry} so transient DB /
   * LLM failures are retried according to the configured retry policy.
   */
  protected async onExecute(
    input: ExtractionInput,
    signal?: AbortSignal,
  ): Promise<ExtractionOutput> {
    this.ensureExtractor();
    this.throwIfAborted(signal);

    const result = await this.executeWithRetry(async (_attempt) => {
      this.throwIfAborted(signal);
      return this.extractor!.processThread(input.spaceId, input.threadId, input.userId);
    });

    logInfo(
      `Extraction complete for thread ${input.threadId}: ` +
        `${result.extracted} extracted, ${result.saved} saved`,
      { module: 'memory/extraction-agent' },
    );

    return {
      extracted: result.extracted,
      saved: result.saved,
      threadId: input.threadId,
    };
  }

  // ── Message handling ──────────────────────────────────────────

  /** @inheritdoc */
  protected async onMessage(message: AgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'extract-thread':
        return this.handleExtractThread(message.payload as ExtractThreadPayload);

      case 'batch-extract':
        return this.handleBatchExtract(message.payload as BatchExtractPayload);

      default:
        return super.onMessage(message);
    }
  }

  /**
   * Handle a request to extract memories from a single thread.
   */
  private async handleExtractThread(payload: ExtractThreadPayload): Promise<ExtractionOutput> {
    this.ensureExtractor();

    const result = await this.executeWithRetry(async (_attempt) => {
      return this.extractor!.processThread(payload.spaceId, payload.threadId, payload.userId);
    });

    return {
      extracted: result.extracted,
      saved: result.saved,
      threadId: payload.threadId,
    };
  }

  /**
   * Handle a batch extraction request — processes threads sequentially
   * so individual failures do not block the remaining threads.
   */
  private async handleBatchExtract(
    payload: BatchExtractPayload,
  ): Promise<{ results: ExtractionOutput[]; errors: Array<{ threadId: string; error: string }> }> {
    this.ensureExtractor();

    const results: ExtractionOutput[] = [];
    const errors: Array<{ threadId: string; error: string }> = [];

    for (const { threadId, userId } of payload.threads) {
      try {
        const result = await this.executeWithRetry(async (_attempt) => {
          return this.extractor!.processThread(payload.spaceId, threadId, userId);
        });

        results.push({
          extracted: result.extracted,
          saved: result.saved,
          threadId,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logError(`Batch extraction failed for thread ${threadId}`, err, {
          module: 'memory/extraction-agent',
        });
        errors.push({ threadId, error: errorMessage });
      }
    }

    return { results, errors };
  }

  // ── Helpers ───────────────────────────────────────────────────

  /**
   * Guard that throws if the extractor has not been initialised.
   */
  private ensureExtractor(): void {
    if (!this.extractor) {
      throw new Error(
        'MemoryExtractionAgent has not been initialized. Call initialize() first.',
      );
    }
  }
}

/**
 * Factory function matching the project convention for service creation.
 */
export function createMemoryExtractionAgent(
  db: D1Database,
  apiKey?: string,
): MemoryExtractionAgent {
  return new MemoryExtractionAgent(db, apiKey);
}
