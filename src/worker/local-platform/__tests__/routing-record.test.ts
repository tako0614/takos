import { test } from "bun:test";
import {
  assertEquals,
  assertNotStrictEquals,
} from "@takos/test/assert";
import type { RoutingRecord } from "../../application/services/routing/routing-models.ts";
import { cloneRecord, normalizeHostname } from "../routing-record.ts";

test("routing-record normalizes hostnames and clones records deeply", () => {
  assertEquals(normalizeHostname("  APP.Example  "), "app.example");
  assertEquals(cloneRecord(null), null);

  const record: RoutingRecord = {
    hostname: "app.example",
    target: {
      type: "deployments",
      deployments: [{ routeRef: "main", weight: 100 }],
    },
    version: 3,
    updatedAt: 42,
    tombstoneUntil: 100,
  };

  const clone = cloneRecord(record);
  assertEquals(clone, record);
  assertNotStrictEquals(clone, record);
  if (!clone || !clone.target || clone.target.type !== "deployments") {
    throw new Error("expected a deployment routing record clone");
  }
  if (!record.target || record.target.type !== "deployments") {
    throw new Error("expected a deployment routing record");
  }
  assertNotStrictEquals(clone.target, record.target);
  assertNotStrictEquals(clone.target.deployments, record.target.deployments);
  assertNotStrictEquals(
    clone.target.deployments[0],
    record.target.deployments[0],
  );

  clone.target.deployments[0]!.weight = 50;
  assertEquals(record.target.deployments[0]!.weight, 100);
});
