import { desc, eq, sql } from "drizzle-orm";

import {
  appUsageEvents,
  appUsageRollups,
  getDb,
  runs,
} from "../../../infra/db/index.ts";
import type { Database } from "../../../infra/db/index.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import {
  generateId,
  safeJsonParseOrDefault,
} from "../../../shared/utils/index.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import { getUsageEventsFromR2 } from "../offload/usage-events.ts";
import {
  APP_USAGE_METER_TYPES,
  type AppUsageMeterType,
  type AppUsageRecordInput,
  type AppUsageRecordResult,
} from "./usage-types.ts";

type AppUsageDb = SqlDatabaseBinding | Database;

function getCurrentPeriodStart(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function isAppUsageMeterType(value: string): value is AppUsageMeterType {
  return (APP_USAGE_METER_TYPES as readonly string[]).includes(value);
}

export async function recordAppUsage(
  d1: AppUsageDb,
  input: AppUsageRecordInput,
): Promise<AppUsageRecordResult> {
  if (!Number.isFinite(input.units) || input.units <= 0) {
    return { success: true, applied: false, eventId: "" };
  }

  const db = getDb(d1);
  const eventId = generateId();
  const now = new Date().toISOString();
  const metadataJson = input.metadata ? JSON.stringify(input.metadata) : "{}";
  const scopeType = input.spaceId ? "space" : "account";
  const scopeId = input.spaceId ?? input.ownerAccountId;
  let applied = true;

  if (input.idempotencyKey) {
    const inserted = await db.insert(appUsageEvents)
      .values({
        id: eventId,
        idempotencyKey: input.idempotencyKey,
        ownerAccountId: input.ownerAccountId,
        scopeType,
        spaceId: input.spaceId ?? null,
        meterType: input.meterType,
        units: input.units,
        referenceId: input.referenceId ?? null,
        referenceType: input.referenceType ?? null,
        metadata: metadataJson,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: appUsageEvents.id });
    applied = inserted.length > 0;
  } else {
    await db.insert(appUsageEvents).values({
      id: eventId,
      ownerAccountId: input.ownerAccountId,
      scopeType,
      spaceId: input.spaceId ?? null,
      meterType: input.meterType,
      units: input.units,
      referenceId: input.referenceId ?? null,
      referenceType: input.referenceType ?? null,
      metadata: metadataJson,
      createdAt: now,
    });
  }

  if (applied) {
    const periodStart = getCurrentPeriodStart();
    await db.insert(appUsageRollups)
      .values({
        id: generateId(),
        ownerAccountId: input.ownerAccountId,
        scopeType,
        scopeId,
        spaceId: input.spaceId ?? null,
        meterType: input.meterType,
        periodStart,
        units: input.units,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          appUsageRollups.ownerAccountId,
          appUsageRollups.scopeType,
          appUsageRollups.scopeId,
          appUsageRollups.meterType,
          appUsageRollups.periodStart,
        ],
        set: {
          units: sql`${appUsageRollups.units} + ${input.units}`,
          updatedAt: now,
        },
      });
  }

  return { success: true, applied, eventId: applied ? eventId : "" };
}

export async function recordRunUsageBatch(
  env: Env,
  runId: string,
): Promise<void> {
  const db = getDb(env.DB);
  const run = await db
    .select({ usage: runs.usage, accountId: runs.accountId })
    .from(runs)
    .where(eq(runs.id, runId))
    .get();

  if (!run?.accountId) return;

  const aggregated = new Map<AppUsageMeterType, number>();
  const usage = safeJsonParseOrDefault<
    { inputTokens?: number; outputTokens?: number }
  >(run.usage, {});
  const inputK = (usage.inputTokens ?? 0) / 1000;
  const outputK = (usage.outputTokens ?? 0) / 1000;
  if (inputK > 0) aggregated.set("llm_tokens_input", inputK);
  if (outputK > 0) aggregated.set("llm_tokens_output", outputK);

  if (env.TAKOS_OFFLOAD) {
    try {
      const raw = await getUsageEventsFromR2(env.TAKOS_OFFLOAD, runId, {
        maxEvents: 50_000,
      });
      for (const ev of raw) {
        if (!isAppUsageMeterType(ev.meter_type)) continue;
        const units = typeof ev.units === "number" ? ev.units : NaN;
        if (!Number.isFinite(units) || units <= 0) continue;
        aggregated.set(
          ev.meter_type,
          (aggregated.get(ev.meter_type) ?? 0) + units,
        );
      }
    } catch (err) {
      logWarn("[USAGE] Failed to read raw usage events from object store", {
        action: "recordRunUsageBatch",
        runId,
        errorValue: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const [meterType, units] of aggregated.entries()) {
    try {
      await recordAppUsage(env.DB, {
        ownerAccountId: run.accountId,
        spaceId: run.accountId,
        meterType,
        units,
        referenceId: runId,
        referenceType: "run",
        idempotencyKey: `run:${runId}:${meterType}`,
      });
    } catch (err) {
      logError("[USAGE] recordAppUsage failed", err, {
        action: "recordRunUsageBatch",
        runId,
        meterType,
      });
    }
  }
}

export async function listAppUsageForOwner(
  d1: AppUsageDb,
  ownerAccountId: string,
): Promise<{
  events: unknown[];
  rollups: unknown[];
}> {
  const db = getDb(d1);
  const events = await db.select().from(appUsageEvents).where(
    eq(appUsageEvents.ownerAccountId, ownerAccountId),
  ).orderBy(desc(appUsageEvents.createdAt)).all();
  const rollups = await db.select().from(appUsageRollups).where(
    eq(appUsageRollups.ownerAccountId, ownerAccountId),
  ).orderBy(desc(appUsageRollups.updatedAt)).all();
  return { events, rollups };
}
