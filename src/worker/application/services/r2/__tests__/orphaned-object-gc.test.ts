import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import {
  r2OrphanedObjectGcDeps,
  runR2OrphanedObjectGcBatch,
} from "../orphaned-object-gc.ts";

type ListedObject = {
  key: string;
  uploaded?: Date;
};

type ListResult = {
  objects: ListedObject[];
  truncated?: boolean;
  cursor?: string;
};

function createObjectStore(pages: Record<string, ListResult>) {
  const writes: Array<{ key: string; value: string }> = [];

  return {
    writes,
    binding: {
      async get() {
        return null;
      },
      async put(key: string, value: string) {
        writes.push({ key, value });
      },
      async list(options: { prefix?: string }) {
        return pages[options.prefix ?? ""] ?? { objects: [] };
      },
      async delete() {},
    },
  };
}

test("runR2OrphanedObjectGcBatch does not create offload state for an empty fresh install", async () => {
  const originalGetDb = r2OrphanedObjectGcDeps.getDb;
  const source = createObjectStore({
    "blobs/": { objects: [] },
    "trees/": { objects: [] },
  });
  const offload = createObjectStore({});

  r2OrphanedObjectGcDeps.getDb = () => ({}) as never;
  try {
    const summary = await runR2OrphanedObjectGcBatch(
      {
        DB: {} as never,
        TENANT_SOURCE: source.binding as never,
        TAKOS_OFFLOAD: offload.binding as never,
      },
      {
        maxDeletes: 200,
        listLimit: 200,
        minAgeMinutes: 24 * 60,
      },
    );

    assertEquals(summary.scanned, { blobs: 0, trees: 0 });
    assertEquals(summary.deleted, { blobs: 0, trees: 0 });
    assertEquals(offload.writes, []);
  } finally {
    r2OrphanedObjectGcDeps.getDb = originalGetDb;
  }
});

test("runR2OrphanedObjectGcBatch persists cursor state when scanning is truncated", async () => {
  const originalGetDb = r2OrphanedObjectGcDeps.getDb;
  const source = createObjectStore({
    "blobs/": {
      objects: [],
      truncated: true,
      cursor: "next-blobs",
    },
    "trees/": { objects: [] },
  });
  const offload = createObjectStore({});

  r2OrphanedObjectGcDeps.getDb = () => ({}) as never;
  try {
    const summary = await runR2OrphanedObjectGcBatch({
      DB: {} as never,
      TENANT_SOURCE: source.binding as never,
      TAKOS_OFFLOAD: offload.binding as never,
    });

    assertEquals(summary.next_cursors.blobs, "next-blobs");
    assertEquals(offload.writes.length, 1);
    assertEquals(
      offload.writes[0]?.key,
      "ops/job-state/r2-orphaned-object-gc.json",
    );
    assertEquals(JSON.parse(offload.writes[0]?.value ?? "{}").cursors, {
      blobs: "next-blobs",
    });
  } finally {
    r2OrphanedObjectGcDeps.getDb = originalGetDb;
  }
});
