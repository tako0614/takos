import { parseStorage } from "../app-manifest-parser/index.ts";

import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("parseStorage - parses canonical flat storage types", () => {
  const storage = parseStorage({
    storage: {
      mainDb: {
        type: "sql",
        bind: "DB",
      },
      assets: {
        type: "object-store",
        bind: "ASSETS",
      },
      vectors: {
        type: "vector-index",
        vectorIndex: {
          dimensions: 768,
          metric: "euclidean",
        },
      },
      apikey: {
        type: "secret",
        bind: "API_KEY",
      },
      analytics: {
        type: "analytics-engine",
        bind: "ANALYTICS",
      },
    },
  } as unknown as Record<string, unknown>);

  assertEquals(storage.mainDb.type, "sql");
  assertEquals(storage.assets.type, "object-store");
  assertEquals(storage.vectors.type, "vector-index");
  assertEquals(storage.apikey.type, "secret");
  assertEquals(storage.analytics.type, "analytics-engine");
});

Deno.test("parseStorage - parses workflow and durable-object storage", () => {
  const storage = parseStorage({
    storage: {
      jobs: {
        type: "workflow",
        workflow: {
          class: "JobRunner",
          script: "api",
        },
      },
      rooms: {
        type: "durable-object",
        durableObject: {
          class: "Room",
          script: "api",
        },
      },
    },
  } as unknown as Record<string, unknown>);

  assertEquals(storage.jobs.type, "workflow");
  assertEquals(storage.rooms.type, "durable-object");
});

Deno.test("parseStorage - throws for unsupported type", () => {
  assertThrows(
    () =>
      parseStorage({
        storage: {
          bad: {
            type: "sql-engine",
          },
        },
      } as unknown as Record<string, unknown>),
    Error,
    "storage.bad.type",
  );
});
