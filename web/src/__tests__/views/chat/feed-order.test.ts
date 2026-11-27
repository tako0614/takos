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

test("compareFeedItems - maintains transitive ordering across mixed sequenced/unsequenced messages, 0/negative sequences, and NaN timestamps", () => {
  const ts = Date.parse("2026-11-26T10:00:00.000Z");
  const a: OrderableFeedItem = {
    type: "message",
    key: "message:c",
    createdAt: ts,
    sequence: 0,
  };
  const b: OrderableFeedItem = {
    type: "message",
    key: "message:b",
    createdAt: ts,
  };
  const c: OrderableFeedItem = {
    type: "message",
    key: "message:a",
    createdAt: ts,
    sequence: 2,
  };
  const d: OrderableFeedItem = {
    type: "message",
    key: "message:d",
    createdAt: ts,
    sequence: -1,
  };

  // Every permutation must produce the exact same deterministic order:
  // sequenced (-1, 0, 2) before unsequenced (b).
  const expected = ["message:d", "message:c", "message:a", "message:b"];
  const perms: OrderableFeedItem[][] = [
    [a, b, c, d],
    [b, c, d, a],
    [c, b, a, d],
    [d, b, c, a],
  ];
  for (const perm of perms) {
    assertEquals(
      [...perm].sort(compareFeedItems).map((item) => item.key),
      expected,
    );
  }

  // Non-finite timestamps normalize to 0 deterministically.
  const nanItems: OrderableFeedItem[] = [
    { type: "message", key: "message:real", createdAt: ts, sequence: 1 },
    { type: "message", key: "message:nan", createdAt: Number.NaN, sequence: 5 },
  ];
  nanItems.sort(compareFeedItems);
  assertEquals(
    nanItems.map((item) => item.key),
    ["message:nan", "message:real"],
  );
});
