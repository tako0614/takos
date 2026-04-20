import { isNotNull } from "drizzle-orm";

import { groups } from "../../../infra/db/schema-groups.ts";
import { getDb } from "../../../infra/db/client.ts";
import type { Env } from "../../../shared/types/index.ts";
import type { ControlPlatform } from "../../../platform/platform-config.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/index.ts";
import type { AppManifest } from "../source/app-manifest-types.ts";
import type { GroupDesiredState } from "./group-state.ts";
import { compileGroupDesiredState } from "./group-state.ts";
import { getGroupState } from "./apply-engine.ts";

export type ScheduledTriggerError = {
  job: string;
  error: string;
};

export type ScheduledDispatchTarget = {
  groupId: string;
  groupName: string;
  workloadName: string;
  routeRef: string;
  cron: string;
};

export type ScheduledDispatchSummary = {
  groupsScanned: number;
  manifestsParsed: number;
  targetsMatched: number;
  targetsDispatched: number;
  targetsSkipped: number;
};

type ScheduledWorkerBinding = {
  scheduled?(
    options?: { scheduledTime?: Date; cron?: string },
  ): Promise<{ outcome: string; noRetry: boolean }>;
};

type ScheduledObservedGroupState = {
  workloads?: Record<string, { routeRef?: string }>;
};

function normalizeCron(cron: string): string {
  return cron.trim();
}

const QUARTER_HOUR_CRONS = new Set([
  "*/15 * * * *",
  "0,15,30,45 * * * *",
  "3,18,33,48 * * * *",
]);

const HOURLY_CRONS = new Set([
  "0 * * * *",
  "5 * * * *",
]);

function isQuarterHourCron(cron: string): boolean {
  return QUARTER_HOUR_CRONS.has(normalizeCron(cron));
}

function isHourlyCron(cron: string): boolean {
  return HOURLY_CRONS.has(normalizeCron(cron));
}

function scheduleMatchesControlTick(
  controlCron: string,
  scheduleCron: string,
): boolean {
  const normalizedControlCron = normalizeCron(controlCron);
  const normalizedScheduleCron = normalizeCron(scheduleCron);

  if (normalizedControlCron === normalizedScheduleCron) return true;
  if (isQuarterHourCron(normalizedControlCron)) {
    return isQuarterHourCron(normalizedScheduleCron);
  }
  if (isHourlyCron(normalizedControlCron)) {
    return isHourlyCron(normalizedScheduleCron);
  }
  return false;
}

export function selectScheduledDispatchTargets(
  desiredState: GroupDesiredState,
  cron: string,
  options?: {
    groupId?: string;
    observedState?: ScheduledObservedGroupState | null;
  },
): ScheduledDispatchTarget[] {
  const normalizedCron = normalizeCron(cron);
  const targets: ScheduledDispatchTarget[] = [];
  const seen = new Set<string>();
  const groupId = options?.groupId ?? desiredState.groupName;
  const observedState = options?.observedState;

  for (
    const [workloadName, workload] of Object.entries(desiredState.workloads)
  ) {
    if (workload.category !== "worker") continue;

    const schedules = workload.spec.triggers?.schedules ?? [];
    for (const schedule of schedules) {
      if (!scheduleMatchesControlTick(normalizedCron, schedule.cron)) continue;

      const dedupeKey = `${workloadName}\u0000${normalizeCron(schedule.cron)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const observedWorkload = observedState?.workloads?.[workloadName];

      targets.push({
        groupId,
        groupName: desiredState.groupName,
        workloadName,
        routeRef: observedWorkload?.routeRef?.trim() ||
          workloadName,
        cron: normalizeCron(schedule.cron),
      });
    }
  }

  return targets.sort((a, b) =>
    a.workloadName.localeCompare(b.workloadName) ||
    a.cron.localeCompare(b.cron) ||
    a.routeRef.localeCompare(b.routeRef)
  );
}

async function loadScheduledGroupManifest(
  env: Env,
): Promise<
  Array<{
    id: string;
    name: string;
    backend: string | null;
    env: string | null;
    desiredSpecJson: string;
  }>
> {
  const db = getDb(env.DB);
  return db.select({
    id: groups.id,
    name: groups.name,
    backend: groups.backend,
    env: groups.env,
    desiredSpecJson: groups.desiredSpecJson,
  })
    .from(groups)
    .where(isNotNull(groups.desiredSpecJson))
    .all() as Promise<
      Array<{
        id: string;
        name: string;
        backend: string | null;
        env: string | null;
        desiredSpecJson: string;
      }>
    >;
}

function createScheduledBinding(
  platform: ControlPlatform<Env>,
  routeRef: string,
): ScheduledWorkerBinding | null {
  const binding = platform.services.serviceRegistry?.get(routeRef) as
    | ScheduledWorkerBinding
    | undefined;
  if (!binding) return null;
  return binding;
}

export async function dispatchScheduledComputeTriggers(params: {
  env: Env;
  platform: ControlPlatform<Env>;
  cron: string;
  errors: ScheduledTriggerError[];
}): Promise<ScheduledDispatchSummary> {
  const summary: ScheduledDispatchSummary = {
    groupsScanned: 0,
    manifestsParsed: 0,
    targetsMatched: 0,
    targetsDispatched: 0,
    targetsSkipped: 0,
  };

  const groupRows = await loadScheduledGroupManifest(params.env);
  summary.groupsScanned = groupRows.length;

  for (const row of groupRows) {
    const manifest = safeJsonParseOrDefault<AppManifest | null>(
      row.desiredSpecJson,
      null,
    );
    if (!manifest) {
      summary.targetsSkipped++;
      continue;
    }

    summary.manifestsParsed++;

    let desiredState: GroupDesiredState;
    try {
      desiredState = compileGroupDesiredState(manifest, {
        groupName: row.name,
        backend: row.backend ?? "cloudflare",
        envName: row.env ?? "default",
      });
    } catch (error) {
      params.errors.push({
        job: `app-schedules.${row.name}`,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const observedState = await getGroupState(params.env, row.id);
    const targets = selectScheduledDispatchTargets(
      desiredState,
      params.cron,
      {
        groupId: row.id,
        observedState: observedState?.workloads
          ? { workloads: observedState.workloads }
          : undefined,
      },
    );

    if (targets.length === 0) {
      summary.targetsSkipped++;
      continue;
    }

    summary.targetsMatched += targets.length;

    for (const target of targets) {
      const binding = createScheduledBinding(params.platform, target.routeRef);
      if (!binding) {
        summary.targetsSkipped++;
        continue;
      }

      if (typeof binding.scheduled !== "function") {
        summary.targetsSkipped++;
        continue;
      }

      try {
        await binding.scheduled({
          scheduledTime: new Date(),
          cron: target.cron,
        });
        summary.targetsDispatched++;
      } catch (error) {
        params.errors.push({
          job: `app-schedules.${target.groupName}.${target.workloadName}`,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return summary;
}
