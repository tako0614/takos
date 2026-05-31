import type { Run } from "../../types/index.ts";
import type {
  ChatRunMetaMap,
  ChatTimelineEntry,
  ChatTimelineEventType,
} from "./chat-types.ts";
import {
  getTerminalRunStatusFromTimelineEvent,
  parseEventData,
} from "./timeline.ts";

export interface PersistentRunActivityGroup {
  runId: string;
  status: Run["status"];
  entries: ChatTimelineEntry[];
  createdAt: number;
}

const ACTIVE_RUN_STATUSES: ReadonlySet<Run["status"]> = new Set([
  "pending",
  "queued",
  "running",
]);

const TERMINAL_RUN_STATUSES: ReadonlySet<Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const PERSISTED_ACTIVITY_TYPES: ReadonlySet<ChatTimelineEventType> = new Set([
  "thinking",
  "progress",
  "tool_call",
  "tool_result",
  "error",
  "cancelled",
  "run.failed",
]);

export function isPersistentRunActivityEntry(
  entry: ChatTimelineEntry,
): boolean {
  return PERSISTED_ACTIVITY_TYPES.has(entry.type);
}

function deriveTerminalStatusFromEntries(
  entries: ChatTimelineEntry[],
): Run["status"] | null {
  let status: Run["status"] | null = null;
  for (const entry of entries) {
    const terminal = getTerminalRunStatusFromTimelineEvent(
      entry.type,
      parseEventData({ message: entry.message, error: entry.detail }),
    );
    if (terminal) {
      status = terminal;
    }
  }
  return status;
}

export function buildPersistentRunActivityGroups(
  entries: ChatTimelineEntry[],
  runMetaById: ChatRunMetaMap,
): PersistentRunActivityGroup[] {
  return buildRunActivityGroups(entries, runMetaById, {
    includeActive: false,
  });
}

export function buildActiveRunActivityGroups(
  entries: ChatTimelineEntry[],
  runMetaById: ChatRunMetaMap,
): PersistentRunActivityGroup[] {
  return buildRunActivityGroups(entries, runMetaById, {
    includeActive: true,
  }).filter((group) => ACTIVE_RUN_STATUSES.has(group.status));
}

function buildRunActivityGroups(
  entries: ChatTimelineEntry[],
  runMetaById: ChatRunMetaMap,
  options: { includeActive: boolean },
): PersistentRunActivityGroup[] {
  const entriesByRunId = new Map<string, ChatTimelineEntry[]>();
  for (const entry of entries) {
    const list = entriesByRunId.get(entry.runId) ?? [];
    list.push(entry);
    entriesByRunId.set(entry.runId, list);
  }

  const groups: PersistentRunActivityGroup[] = [];
  for (const [runId, runEntries] of entriesByRunId) {
    const activityEntries = runEntries.filter(isPersistentRunActivityEntry);
    if (activityEntries.length === 0) {
      continue;
    }

    const metaStatus = runMetaById[runId]?.status;
    const derivedTerminalStatus = deriveTerminalStatusFromEntries(runEntries);
    const status = derivedTerminalStatus ?? metaStatus ?? "running";

    if (
      !options.includeActive &&
      ACTIVE_RUN_STATUSES.has(status) &&
      !TERMINAL_RUN_STATUSES.has(status)
    ) {
      continue;
    }

    activityEntries.sort((a, b) =>
      a.createdAt === b.createdAt ? a.seq - b.seq : a.createdAt - b.createdAt
    );
    groups.push({
      runId,
      status,
      entries: activityEntries,
      createdAt: activityEntries[0]?.createdAt ?? 0,
    });
  }

  groups.sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.runId.localeCompare(b.runId)
      : a.createdAt - b.createdAt
  );
  return groups;
}
