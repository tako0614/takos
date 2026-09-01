import { expect, test } from "bun:test";

import {
  applyThreadLifecycleToInventory,
  mapWithConcurrency,
  selectThreadInventorySpaces,
  THREAD_INVENTORY_CONCURRENCY,
  type ThreadNavigationState,
} from "../../lib/thread-navigation.ts";
import { MAX_CHAT_THREADS_PER_RESPONSE } from "takos-api-contract/chat-thread";
import type { Space, Thread } from "../../types/index.ts";

function space(id: string): Space {
  return {
    id,
    slug: id,
    name: id,
    description: null,
    is_default: id === "personal",
    security_posture: "standard",
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
  };
}

test("Thread navigation fetches only the personal and current Workspace", () => {
  const personal = space("personal");
  const current = space("current");
  expect(
    selectThreadInventorySpaces(personal, current, current).map(({ id }) => id),
  ).toEqual(["personal", "current"]);
});

test("Thread inventory fan-out is ordered and concurrency bounded", async () => {
  expect(THREAD_INVENTORY_CONCURRENCY).toBe(4);
  let active = 0;
  let maximumActive = 0;
  const values = Array.from({ length: 20 }, (_, index) => index);
  const results = await mapWithConcurrency(
    values,
    THREAD_INVENTORY_CONCURRENCY,
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      return value * 2;
    },
  );
  expect(results).toEqual(values.map((value) => value * 2));
  expect(maximumActive).toBe(THREAD_INVENTORY_CONCURRENCY);
  await expect(
    mapWithConcurrency(values, 0, async (value) => value),
  ).rejects.toThrow("Concurrency must be a positive safe integer");
});

function thread(id: string, spaceId = "space-record-1"): Thread {
  return {
    id,
    space_id: spaceId,
    title: id,
    locale: "en",
    status: "active",
    summary: null,
    key_points: "[]",
    retrieval_index: -1,
    context_window: 20,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
  };
}

test("accepted Thread lifecycle actions update verified inventory without refetch", () => {
  const archived = thread("thread-1");
  const initial: ThreadNavigationState = {
    threadsBySpace: {
      workspace: [archived, thread("thread-2")],
      other: [archived],
    },
    truncatedBySpace: { workspace: true, other: false },
    failedBySpace: { workspace: false, other: false },
  };

  const removed = applyThreadLifecycleToInventory(
    initial,
    archived,
    "archived",
    "workspace",
  );
  expect(removed.threadsBySpace).toEqual({
    workspace: [thread("thread-2")],
    other: [],
  });
  expect(removed.truncatedBySpace).toEqual({ workspace: true, other: false });
  expect(removed.failedBySpace).toEqual({ workspace: false, other: false });

  const restored = applyThreadLifecycleToInventory(
    removed,
    { ...archived, status: "archived" },
    "active",
    "workspace",
  );
  expect(restored.threadsBySpace.workspace.map(({ id }) => id)).toEqual([
    "thread-1",
    "thread-2",
  ]);
  expect(restored.threadsBySpace.other).toEqual([]);
});

test("unarchive keeps the bounded inventory and explicit truncation evidence", () => {
  const full = Array.from(
    { length: MAX_CHAT_THREADS_PER_RESPONSE },
    (_, index) => thread(`thread-${index}`),
  );
  const restored = applyThreadLifecycleToInventory(
    {
      threadsBySpace: { workspace: full },
      truncatedBySpace: { workspace: false },
      failedBySpace: { workspace: false },
    },
    { ...thread("restored"), status: "archived" },
    "active",
    "workspace",
  );

  expect(restored.threadsBySpace.workspace).toHaveLength(
    MAX_CHAT_THREADS_PER_RESPONSE,
  );
  expect(restored.threadsBySpace.workspace[0]?.id).toBe("restored");
  expect(restored.truncatedBySpace.workspace).toBe(true);
});
