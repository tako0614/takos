import { eq, sql } from "drizzle-orm";

import {
  accounts,
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
import { readUsageEventArchiveFromR2 } from "../offload/usage-events.ts";
import {
  APP_USAGE_METER_TYPES,
  type AppUsageMeterType,
  type AppUsageRecordInput,
  type AppUsageRecordResult,
} from "./usage-types.ts";

type AppUsageDb = SqlDatabaseBinding | Database;

const MAX_APP_USAGE_METADATA_BYTES = 16 * 1024;
const usageEncoder = new TextEncoder();

function getCurrentPeriodStart(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function isAppUsageMeterType(value: string): value is AppUsageMeterType {
  return (APP_USAGE_METER_TYPES as readonly string[]).includes(value);
}

function isAuxiliaryRunMeterType(value: string): value is AppUsageMeterType {
  return isAppUsageMeterType(value) &&
    value !== "llm_tokens_input" && value !== "llm_tokens_output";
}

export async function recordAppUsage(
  d1: AppUsageDb,
  input: AppUsageRecordInput,
): Promise<AppUsageRecordResult> {
  if (
    !Number.isFinite(input.units) || input.units <= 0 ||
    input.units > Number.MAX_SAFE_INTEGER
  ) {
    return { success: true, applied: false, eventId: "" };
  }

  const db = getDb(d1);
  const eventId = generateId();
  const now = new Date().toISOString();
  let metadataJson: string;
  try {
    metadataJson = input.metadata ? JSON.stringify(input.metadata) : "{}";
  } catch {
    throw new Error("App usage metadata must be JSON serializable");
  }
  if (usageEncoder.encode(metadataJson).byteLength > MAX_APP_USAGE_METADATA_BYTES) {
    throw new Error("App usage metadata is too large");
  }
  const scopeType = input.spaceId ? "space" : "account";
  const scopeId = input.spaceId ?? input.ownerAccountId;
  const periodStart = getCurrentPeriodStart();
  const rollupId = generateId();

  const insertEvent = db.insert(appUsageEvents).values({
    id: eventId,
    idempotencyKey: input.idempotencyKey ?? null,
    ownerAccountId: input.ownerAccountId,
    scopeType,
    spaceId: input.spaceId ?? null,
    meterType: input.meterType,
    units: input.units,
    referenceId: input.referenceId ?? null,
    referenceType: input.referenceType ?? null,
    metadata: metadataJson,
    createdAt: now,
  }).onConflictDoNothing();
  const incrementRollup = db.insert(appUsageRollups).select(
    db.select({
      id: sql<string>`${rollupId}`,
      ownerAccountId: appUsageEvents.ownerAccountId,
      scopeType: appUsageEvents.scopeType,
      scopeId: sql<string>`${scopeId}`,
      spaceId: appUsageEvents.spaceId,
      meterType: appUsageEvents.meterType,
      periodStart: sql<string>`${periodStart}`,
      units: appUsageEvents.units,
      updatedAt: sql<string>`${now}`,
    }).from(appUsageEvents).where(eq(appUsageEvents.id, eventId)),
  ).onConflictDoUpdate({
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

  // The rollup SELECT sees only the freshly generated event id. If the event
  // insert loses an idempotency conflict, it yields no row and therefore
  // cannot increment the rollup. D1 batch is atomic, so a rollup failure also
  // rolls back the event instead of creating a permanently undercounted key.
  await db.batch([insertEvent, incrementRollup]);
  const applied = Boolean(await db.select({ id: appUsageEvents.id })
    .from(appUsageEvents)
    .where(eq(appUsageEvents.id, eventId))
    .get());

  return { success: true, applied, eventId: applied ? eventId : "" };
}

export async function recordRunUsageBatch(
  env: Env,
  runId: string,
): Promise<void> {
  const db = getDb(env.DB);
  const run = await db
    .select({
      usage: runs.usage,
      spaceId: runs.accountId,
      ownerAccountId: accounts.ownerAccountId,
    })
    .from(runs)
    .innerJoin(accounts, eq(accounts.id, runs.accountId))
    .where(eq(runs.id, runId))
    .get();

  if (!run) return;
  const ownerAccountId = run.ownerAccountId || run.spaceId;

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
      const archive = await readUsageEventArchiveFromR2(
        env.TAKOS_OFFLOAD,
        runId,
        {
          maxEvents: 50_000,
        },
      );
      if (!archive.complete) {
        logWarn("[USAGE] Auxiliary usage archive is incomplete", {
          action: "recordRunUsageBatch",
          runId,
          reason: archive.reason,
        });
      } else {
        for (const ev of archive.events) {
          // Run token totals have one canonical authority: runs.usage. Raw
          // auxiliary events cannot add a second copy of those meters.
          if (!isAuxiliaryRunMeterType(ev.meter_type)) continue;
          const units = typeof ev.units === "number" ? ev.units : NaN;
          if (!Number.isFinite(units) || units <= 0) continue;
          aggregated.set(
            ev.meter_type,
            (aggregated.get(ev.meter_type) ?? 0) + units,
          );
        }
      }
    } catch (err) {
      logWarn("[USAGE] Failed to read raw usage events from object store", {
        action: "recordRunUsageBatch",
        runId,
        errorValue: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const failures: Error[] = [];
  for (const [meterType, units] of aggregated.entries()) {
    try {
      await recordAppUsage(env.DB, {
        ownerAccountId,
        spaceId: run.spaceId,
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
      failures.push(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to record ${failures.length} Run usage meter(s)`,
    );
  }
}
