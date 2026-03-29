/**
 * Run-level batch usage recording.
 *
 * Aggregates LLM token usage and tool usage events from R2 for a completed
 * run, then records them idempotently via the core usage recording functions.
 */
import type { Env } from '../../../shared/types';
/**
 * Batch-record all usage for a run (LLM tokens + raw usage events from R2).
 *
 * Idempotent by construction via `usage_events.idempotency_key`:
 * - `run:${runId}:${meterType}`
 */
export declare function recordRunUsageBatch(env: Env, runId: string): Promise<void>;
//# sourceMappingURL=billing-run-usage.d.ts.map