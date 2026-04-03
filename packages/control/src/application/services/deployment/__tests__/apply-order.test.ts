import { assertEquals } from "jsr:@std/assert";

import type { DiffEntry } from "../diff.ts";
import type { GroupDesiredState } from "../group-state.ts";
import { topologicalSortApplyEntries } from "../apply-order.ts";

const desiredState = {
  workloads: {
    gateway: {
      dependsOn: ["db", "worker-base"],
    },
    "worker-base": {
      dependsOn: ["db"],
    },
    db: {
      dependsOn: [],
    },
  },
} as unknown as GroupDesiredState;

function sortNames(entries: DiffEntry[]): string[] {
  return topologicalSortApplyEntries(entries, desiredState).map((entry) =>
    `${entry.action}:${entry.name}`
  );
}

Deno.test("topologicalSortApplyEntries orders creates after their dependencies", () => {
  const entries: DiffEntry[] = [
    { name: "gateway", category: "worker", action: "create" },
    { name: "db", category: "resource", action: "create" },
    { name: "worker-base", category: "worker", action: "create" },
  ];

  assertEquals(sortNames(entries), [
    "create:db",
    "create:worker-base",
    "create:gateway",
  ]);
});

Deno.test("topologicalSortApplyEntries reverses delete order across dependencies", () => {
  const entries: DiffEntry[] = [
    { name: "gateway", category: "worker", action: "delete" },
    { name: "db", category: "resource", action: "delete" },
    { name: "worker-base", category: "worker", action: "delete" },
  ];

  assertEquals(sortNames(entries), [
    "delete:gateway",
    "delete:worker-base",
    "delete:db",
  ]);
});

Deno.test("topologicalSortApplyEntries keeps category priority for unrelated entries", () => {
  const entries: DiffEntry[] = [
    { name: "api-route", category: "route", action: "create" },
    { name: "db", category: "resource", action: "create" },
    { name: "gateway", category: "worker", action: "create" },
  ];

  assertEquals(sortNames(entries), [
    "create:db",
    "create:gateway",
    "create:api-route",
  ]);
});
