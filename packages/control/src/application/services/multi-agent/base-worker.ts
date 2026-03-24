/**
 * Multi-Agent Framework — Base worker implementation.
 *
 * Provides the AbstractAgentWorker base class that handles common concerns:
 * - Lifecycle management (initialize, execute, shutdown)
 * - Status tracking and health reporting
 * - Abort signal handling
 * - Error classification and retry logic
 */

import type {
  AgentId,
  AgentRole,
  AgentStatus,
  AgentWorker,
  AgentWorkerConfig,
  AgentMessage,
  AgentResponse,
  AgentHealthInfo,
  RetryPolicy,
  DEFAULT_RETRY_POLICY,
} from './types';
import { generateId } from '../../../shared/utils';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';

export abstract class AbstractAgentWorker<TInput = unknown, TOutput = unknown>
  implements AgentWorker<TInput, TOutput>
{
  readonly id: AgentId;
  readonly role: AgentRole;
  private _status: AgentStatus = 'idle';
  private _activeTaskCount = 0;
  private _completedTaskCount = 0;
  private _failedTaskCount = 0;
  private _startedAt = 0;
  private _lastActivityAt = 0;
  protected config: AgentWorkerConfig | null = null;
  protected retryPolicy: RetryPolicy | null = null;

  constructor(role: AgentRole, id?: AgentId) {
    this.id = id ?? `${role}-${generateId()}`;
    this.role = role;
  }

  get status(): AgentStatus {
    return this._status;
  }

  protected setStatus(status: AgentStatus): void {
    this._status = status;
    this._lastActivityAt = Date.now();
  }

  async initialize(config: AgentWorkerConfig): Promise<void> {
    this.config = config;
    this.retryPolicy = config.retryPolicy ?? null;
    this._startedAt = Date.now();
    this.setStatus('starting');

    try {
      await this.onInitialize(config);
      this.setStatus('idle');
      logInfo(`Agent ${this.id} (${this.role}) initialized`, { module: 'multi-agent' });
    } catch (err) {
      this.setStatus('failed');
      logError(`Agent ${this.id} initialization failed`, err, { module: 'multi-agent' });
      throw err;
    }
  }

  async execute(input: TInput, signal?: AbortSignal): Promise<TOutput> {
    this.setStatus('running');
    this._activeTaskCount++;
    this._lastActivityAt = Date.now();

    try {
      this.throwIfAborted(signal);
      const result = await this.onExecute(input, signal);
      this._completedTaskCount++;
      this.setStatus('idle');
      return result;
    } catch (err) {
      if (this.isAbortError(err)) {
        this.setStatus('cancelled');
        throw err;
      }
      this._failedTaskCount++;
      this.setStatus('idle');
      throw err;
    } finally {
      this._activeTaskCount = Math.max(0, this._activeTaskCount - 1);
    }
  }

  async handleMessage(message: AgentMessage): Promise<AgentResponse> {
    this._lastActivityAt = Date.now();

    try {
      const result = await this.onMessage(message);
      return {
        messageId: message.id,
        status: 'success',
        payload: result,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        messageId: message.id,
        status: 'error',
        error: errorMessage,
      };
    }
  }

  async shutdown(): Promise<void> {
    this.setStatus('idle');
    try {
      await this.onShutdown();
      logInfo(`Agent ${this.id} (${this.role}) shut down`, { module: 'multi-agent' });
    } catch (err) {
      logWarn(`Agent ${this.id} shutdown error`, { module: 'multi-agent', detail: err });
    }
  }

  getHealthInfo(): AgentHealthInfo {
    return {
      agentId: this.id,
      role: this.role,
      status: this._status,
      activeTaskCount: this._activeTaskCount,
      completedTaskCount: this._completedTaskCount,
      failedTaskCount: this._failedTaskCount,
      lastActivityAt: this._lastActivityAt,
      uptime: this._startedAt > 0 ? Date.now() - this._startedAt : 0,
    };
  }

  // ── Retry helper ────────────────────────────────────────────────

  protected async executeWithRetry<T>(
    fn: (attempt: number) => Promise<T>,
    policy?: RetryPolicy,
  ): Promise<T> {
    const p = policy ?? this.retryPolicy;
    if (!p) {
      return fn(1);
    }

    let lastError: Error | undefined;
    let backoff = p.backoffMs;

    for (let attempt = 1; attempt <= p.maxRetries + 1; attempt++) {
      try {
        return await fn(attempt);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt > p.maxRetries) break;
        if (this.isAbortError(err)) throw err;

        logWarn(`Agent ${this.id} retry ${attempt}/${p.maxRetries}: ${lastError.message}`, {
          module: 'multi-agent',
        });
        await this.sleep(backoff);
        backoff = Math.min(backoff * p.backoffMultiplier, p.maxBackoffMs);
      }
    }

    throw lastError!;
  }

  // ── Utilities ───────────────────────────────────────────────────

  protected throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const reason = signal.reason;
      throw reason instanceof Error ? reason : new Error(String(reason ?? 'Agent aborted'));
    }
  }

  protected isAbortError(err: unknown): boolean {
    if (err instanceof DOMException && err.name === 'AbortError') return true;
    if (err instanceof Error && err.message.includes('aborted')) return true;
    return false;
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── Abstract methods for subclasses ─────────────────────────────

  /** Called during initialize(). Override to set up agent-specific resources. */
  protected abstract onInitialize(config: AgentWorkerConfig): Promise<void>;

  /** Core execution logic. Must be implemented by each agent. */
  protected abstract onExecute(input: TInput, signal?: AbortSignal): Promise<TOutput>;

  /** Handle incoming messages. Override for inter-agent communication. */
  protected async onMessage(message: AgentMessage): Promise<unknown> {
    logWarn(`Agent ${this.id} received unhandled message type: ${message.type}`, {
      module: 'multi-agent',
    });
    return { handled: false };
  }

  /** Called during shutdown(). Override to clean up resources. */
  protected async onShutdown(): Promise<void> {
    // Default: no-op
  }
}
