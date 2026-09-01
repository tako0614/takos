import type { Message } from "../types/index.ts";

/**
 * Reconcile the initial history response with messages already created by the
 * live composer while that response was in flight.
 *
 * History remains the ordering authority, but an existing client copy wins
 * for duplicate IDs because it may already reflect a newer optimistic-to-
 * persisted transition. Client-only messages are appended in their current
 * order so a slow initial response cannot erase an in-flight send.
 */
export function mergeInitialHistoryMessages(
  history: Message[],
  current: Message[],
): Message[] {
  const currentById = new Map(current.map((message) => [message.id, message]));
  const historyIds = new Set(history.map((message) => message.id));

  return [
    ...history.map((message) => currentById.get(message.id) ?? message),
    ...current.filter((message) => !historyIds.has(message.id)),
  ];
}
