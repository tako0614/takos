import type { ChatRunMetaMap, ChatTimelineEntry } from "./chat-types.ts";

export function getFocusedRunEntries(
  entries: ChatTimelineEntry[],
  runId: string | null | undefined,
): ChatTimelineEntry[] {
  if (!runId) {
    return [];
  }

  return entries.filter((entry) => entry.runId === runId);
}

export function getFocusedRunMeta(
  runMetaById: ChatRunMetaMap,
  runId: string | null | undefined,
) {
  if (!runId) {
    return null;
  }

  return runMetaById[runId] ?? null;
}
