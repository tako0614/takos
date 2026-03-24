/**
 * PRReviewAgent — Multi-agent wrapper for AI-powered pull request reviews.
 *
 * Wraps the existing `runAiReview` function as an autonomous agent that can
 * be coordinated by the multi-agent orchestrator. Handles transient LLM
 * failures with retry logic, tracks timing, and supports batch reviews.
 *
 * Responsibilities:
 * - Execute a single PR review with structured output
 * - Batch-review multiple PRs sequentially
 * - Retry transient LLM/network failures via `executeWithRetry`
 * - Report timing and result metrics
 */

import { AbstractAgentWorker } from '../multi-agent/base-worker';
import type {
  AgentMessage,
  AgentWorkerConfig,
  RetryPolicy,
} from '../multi-agent/types';
import { runAiReview, type AiReviewResult } from './ai-review';
import type { Env } from '../../../shared/types';
import { logError, logInfo, logWarn } from '../../../shared/utils/logger';

// ── Input / Output types ───────────────────────────────────────────

export interface ReviewInput {
  env: Env;
  repoId: string;
  pullRequest: {
    id: string;
    number: number;
    title: string;
    description: string | null;
    headBranch: string;
    baseBranch: string;
  };
  spaceId: string;
}

export interface ReviewOutput {
  reviewId: string;
  status: string;
  commentCount: number;
  model: string;
  provider: string;
  duration: number;
}

// ── Agent implementation ───────────────────────────────────────────

/**
 * An agent that performs AI code reviews on pull requests.
 *
 * Delegates the actual review logic to `runAiReview` from `./ai-review`,
 * adding retry handling for transient LLM failures and structured
 * timing/output tracking.
 *
 * @example
 * ```ts
 * const agent = new PRReviewAgent();
 * await agent.initialize({ id: agent.id, role: agent.role, capabilities: [], maxConcurrency: 1, timeoutMs: 120_000 });
 * const result = await agent.execute({
 *   env,
 *   repoId: 'repo_abc',
 *   pullRequest: { id: 'pr_1', number: 42, title: 'Fix bug', description: null, headBranch: 'fix/bug', baseBranch: 'main' },
 *   spaceId: 'space_xyz',
 * });
 * ```
 */
export class PRReviewAgent extends AbstractAgentWorker<ReviewInput, ReviewOutput> {
  /** Retry policy tuned for LLM calls (moderate backoff, limited retries). */
  private static readonly LLM_RETRY_POLICY: RetryPolicy = {
    maxRetries: 2,
    backoffMs: 1500,
    backoffMultiplier: 2,
    maxBackoffMs: 10000,
  };

  constructor(id?: string) {
    super('pr-reviewer', id);
  }

  // ── Lifecycle hooks ────────────────────────────────────────────

  /** @inheritdoc */
  protected async onInitialize(_config: AgentWorkerConfig): Promise<void> {
    // No additional setup required — the agent is stateless between executions.
  }

  /**
   * Execute an AI review for a single pull request.
   *
   * Delegates to `runAiReview`, wrapping the call in `executeWithRetry`
   * to handle transient LLM/network errors. Returns a structured output
   * with review metadata and timing information.
   */
  protected async onExecute(input: ReviewInput, signal?: AbortSignal): Promise<ReviewOutput> {
    this.throwIfAborted(signal);

    const { env, repoId, pullRequest, spaceId } = input;
    const startTime = Date.now();

    logInfo(
      `PRReviewAgent starting review for PR #${pullRequest.number} "${pullRequest.title}"`,
      { module: 'pr-reviewer' },
    );

    const result = await this.executeWithRetry(
      async (attempt) => {
        this.throwIfAborted(signal);

        if (attempt > 1) {
          logWarn(
            `PRReviewAgent retrying review for PR #${pullRequest.number} (attempt ${attempt})`,
            { module: 'pr-reviewer' },
          );
        }

        return runAiReview({
          env,
          repoId,
          pullRequest,
          spaceId,
        });
      },
      PRReviewAgent.LLM_RETRY_POLICY,
    );

    const duration = Date.now() - startTime;

    logInfo(
      `PRReviewAgent completed review for PR #${pullRequest.number} in ${duration}ms ` +
        `(status=${result.review.status}, comments=${result.comments.length})`,
      { module: 'pr-reviewer' },
    );

    return {
      reviewId: result.review.id,
      status: result.review.status,
      commentCount: result.comments.length,
      model: result.model,
      provider: result.provider,
      duration,
    };
  }

  // ── Message handling ───────────────────────────────────────────

  /**
   * Handle inter-agent messages.
   *
   * Supported message types:
   * - `'review-pr'`    — start a single PR review
   * - `'batch-review'` — review multiple PRs sequentially
   */
  protected async onMessage(message: AgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'review-pr':
        return this.handleReviewPRMessage(message);

      case 'batch-review':
        return this.handleBatchReviewMessage(message);

      default:
        logWarn(`PRReviewAgent received unknown message type: ${message.type}`, {
          module: 'pr-reviewer',
        });
        return { handled: false, type: message.type };
    }
  }

  // ── Message handlers ───────────────────────────────────────────

  /**
   * Handle a `review-pr` message by delegating to `execute()`.
   *
   * Expected payload: `ReviewInput`
   */
  private async handleReviewPRMessage(message: AgentMessage): Promise<unknown> {
    const payload = message.payload as Partial<ReviewInput>;

    if (!payload?.env || !payload?.repoId || !payload?.pullRequest || !payload?.spaceId) {
      throw new Error('review-pr message requires env, repoId, pullRequest, and spaceId in payload');
    }

    return this.execute(payload as ReviewInput);
  }

  /**
   * Handle a `batch-review` message by reviewing multiple PRs sequentially.
   *
   * Each PR is reviewed independently; a failure in one does not prevent
   * the remaining PRs from being reviewed.
   *
   * Expected payload:
   * ```ts
   * {
   *   env: Env;
   *   repoId: string;
   *   spaceId: string;
   *   pullRequests: Array<ReviewInput['pullRequest']>;
   * }
   * ```
   */
  private async handleBatchReviewMessage(message: AgentMessage): Promise<unknown> {
    const payload = message.payload as {
      env?: Env;
      repoId?: string;
      spaceId?: string;
      pullRequests?: ReviewInput['pullRequest'][];
    };

    if (!payload?.env || !payload?.repoId || !payload?.spaceId || !payload?.pullRequests) {
      throw new Error(
        'batch-review message requires env, repoId, spaceId, and pullRequests in payload',
      );
    }

    const results: Array<{ prNumber: number; result?: ReviewOutput; error?: string }> = [];

    for (const pullRequest of payload.pullRequests) {
      try {
        const output = await this.execute({
          env: payload.env,
          repoId: payload.repoId,
          pullRequest,
          spaceId: payload.spaceId,
        });
        results.push({ prNumber: pullRequest.number, result: output });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logError(
          `PRReviewAgent batch review failed for PR #${pullRequest.number}`,
          err,
          { module: 'pr-reviewer' },
        );
        results.push({ prNumber: pullRequest.number, error: errorMessage });
      }
    }

    const succeeded = results.filter((r) => r.result != null).length;
    const failed = results.filter((r) => r.error != null).length;

    logInfo(
      `PRReviewAgent batch review complete: ${succeeded} succeeded, ${failed} failed out of ${results.length}`,
      { module: 'pr-reviewer' },
    );

    return {
      total: results.length,
      succeeded,
      failed,
      results,
    };
  }
}
