import { MAX_CHAT_THREADS_PER_RESPONSE } from "takos-api-contract/chat-thread";
import type { Space, Thread } from "../types/index.ts";

export const THREAD_INVENTORY_CONCURRENCY = 4;

export interface ThreadNavigationState {
  threadsBySpace: Record<string, Thread[]>;
  truncatedBySpace: Record<string, boolean>;
  failedBySpace: Record<string, boolean>;
}

export function selectThreadInventorySpaces(
  preferred: Space | undefined,
  route: Space | undefined,
  sidebar: Space | undefined,
): Space[] {
  const spaces = [preferred, route, sidebar].filter(
    (space): space is Space => space !== undefined,
  );
  return spaces.filter((space, index) =>
    spaces.findIndex((candidate) => candidate.id === space.id) === index
  );
}

export function applyThreadLifecycleToInventory(
  state: ThreadNavigationState,
  thread: Thread,
  status: "active" | "archived" | "deleted",
  spaceIdentifier?: string,
): ThreadNavigationState {
  const threadsBySpace = Object.fromEntries(
    Object.entries(state.threadsBySpace).map(([identifier, threads]) => [
      identifier,
      threads.filter((candidate) => candidate.id !== thread.id),
    ]),
  );
  const truncatedBySpace = { ...state.truncatedBySpace };

  if (status === "active" && spaceIdentifier) {
    const activeThread: Thread = { ...thread, status: "active" };
    const target = [
      activeThread,
      ...(threadsBySpace[spaceIdentifier] ?? []),
    ];
    if (target.length > MAX_CHAT_THREADS_PER_RESPONSE) {
      truncatedBySpace[spaceIdentifier] = true;
    }
    threadsBySpace[spaceIdentifier] = target.slice(
      0,
      MAX_CHAT_THREADS_PER_RESPONSE,
    );
  }

  return {
    threadsBySpace,
    truncatedBySpace,
    failedBySpace: { ...state.failedBySpace },
  };
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError("Concurrency must be a positive safe integer");
  }
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await mapper(values[index]);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, values.length) },
      worker,
    ),
  );
  return results;
}
