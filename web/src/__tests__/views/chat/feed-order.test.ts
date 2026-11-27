import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { test } from "bun:test";
import {
  compareFeedItems,
  type OrderableFeedItem,
} from "../../../views/chat/feed-order.ts";

test("compareFeedItems - orders same-timestamp messages by sequence before key", () => {
  const ts = Date.parse("2026-11-26T10:00:00.000Z");
  const items: OrderableFeedItem[] = [
    {
      type: "message",
      key: "message:msg-a-assistant",
      createdAt: ts,
      sequence: 4,
    },
    {
      type: "message",
      key: "message:msg-z-user",
      createdAt: ts,
      sequence: 3,
    },
  ];

  items.sort(compareFeedItems);

  assertEquals(
    items.map((item) => item.key),
    ["message:msg-z-user", "message:msg-a-assistant"],
  );
});

test("compareFeedItems - sorts by createdAt first, then type, then key", () => {
  const t1 = Date.parse("2026-11-26T10:00:00.000Z");
  const t2 = Date.parse("2026-11-26T10:01:00.000Z");
  const items: OrderableFeedItem[] = [
    { type: "run-activity", key: "run-activity:r1", createdAt: t1 },
    { type: "message", key: "message:m2", createdAt: t2, sequence: 1 },
    { type: "message", key: "message:m1", createdAt: t1 },
  ];

  items.sort(compareFeedItems);

  assertEquals(
    items.map((item) => item.key),
    ["message:m1", "run-activity:r1", "message:m2"],
  );
});
