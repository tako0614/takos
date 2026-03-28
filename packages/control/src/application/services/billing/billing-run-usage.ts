/**
 * Run-level batch usage recording.
 *
 * Aggregates LLM token usage and tool usage events from R2 for a completed
 * run, then records them idempotently via the core usage recording functions.
 */

import { getDb, runs } from '../../../infra/db';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import { logWarn, logError } from '../../../shared/utils/logger';
import type { Env } from '../../../shared/types';
import { eq } from 'drizzle-orm';
import { getUsageEventsFromR2 } from '../offload/usage-events';
import type { MeterType } from './billing-types';
import { asMeterType } from './billing-utils';
import { getOrCreateBillingAccount } from './billing-accounts';
import { recordUsage } from './billing-usage';

/**
 * Batch-record all usage for a run (LLM tokens + raw usage events from R2).
 *
 * Idempotent by construction via `usage_events.idempotency_key`:
 * - `run:${runId}:${meterType}`
 */
export async function recordRunUsageBatch(env: Env, runId: string): Promise<void> {
  const db = getDb(env.DB);
  const run = await db
    .select({ usage: runs.usage, accountId: runs.accountId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();

  if (!run) return;
  const ownerId = run.accountId;
  if (!ownerId) return;

  const account = await getOrCreateBillingAccount(env.DB, ownerId);

  // 1) LLM token usage (from runs.usage)
  const usage = safeJsonParseOrDefault<{ inputTokens?: number; outputTokens?: number }>(run.usage, {});
  const inputK = (usage.inputTokens ?? 0) / 1000;
  const outputK = (usage.outputTokens ?? 0) / 1000;

  const aggregated = new Map<MeterType, number>();
  if (inputK > 0) aggregated.set('llm_tokens_input', inputK);
  if (outputK > 0) aggregated.set('llm_tokens_output', outputK);

  // 2) Tool usage (raw events from R2)
  if (env.TAKOS_OFFLOAD) {
    try {
      const raw = await getUsageEventsFromR2(env.TAKOS_OFFLOAD, runId, { maxEvents: 50_000 });
      for (const ev of raw) {
        const meterType = asMeterType(ev.meter_type);
        if (!meterType) continue;
        const units = typeof ev.units === 'number' ? ev.units : NaN;
        if (!Number.isFinite(units) || units <= 0) continue;
        aggregated.set(meterType, (aggregated.get(meterType) ?? 0) + units);
      }
    } catch (err) {
      logWarn('[BILLING] Failed to read raw usage events from R2', {
        action: 'recordRunUsageBatch',
        runId,
        errorValue: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3) Apply aggregated usage idempotently.
  for (const [meterType, units] of aggregated.entries()) {
    if (units <= 0) continue;
    try {
      await recordUsage(env.DB, {
        accountId: account.id,
        spaceId: run.accountId,
        meterType,
        units,
        referenceId: runId,
        referenceType: 'run',
        idempotencyKey: `run:${runId}:${meterType}`,
      });
    } catch (err) {
      logError('[BILLING] recordUsage failed', err, {
        action: 'recordRunUsageBatch',
        runId,
        meterType,
      });
    }
  }
}
