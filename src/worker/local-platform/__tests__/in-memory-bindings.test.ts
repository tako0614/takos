import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { test } from "bun:test";
import {
  createInMemoryObjectStore,
  createInMemorySqlDatabase,
} from "../in-memory-bindings.ts";

import {
  assertEquals,
  assertNotEquals,
  assertObjectMatch,
  assertRejects,
  assertThrows,
} from "@takos/test/assert";

test("createInMemorySqlDatabase refuses to construct in a production environment", () => {
  const originalEnvironment = getEnv("ENVIRONMENT");
  const originalVitest = getEnv("VITEST");
  // Clear test signals so the production guard is reachable.
  deleteEnv("VITEST");
  setEnv("ENVIRONMENT", "production");
  try {
    assertThrows(
      () => createInMemorySqlDatabase(),
      Error,
      "in-memory SQL database refused",
    );
  } finally {
    if (originalEnvironment === undefined) deleteEnv("ENVIRONMENT");
    else setEnv("ENVIRONMENT", originalEnvironment);
    if (originalVitest !== undefined) setEnv("VITEST", originalVitest);
  }
});

test("createInMemorySqlDatabase is allowed (non-production) and is a no-op stub", async () => {
  const originalEnvironment = getEnv("ENVIRONMENT");
  setEnv("ENVIRONMENT", "development");
  try {
    const db = createInMemorySqlDatabase();
    const result = await db.prepare("INSERT INTO t VALUES (1)").run();
    // Honest no-op: write reports no durable change and reads return empty.
    assertEquals(result.meta.changed_db, false);
    assertEquals(result.results, []);
    const read = await db.prepare("SELECT * FROM t").all();
    assertEquals(read.results, []);
  } finally {
    if (originalEnvironment === undefined) deleteEnv("ENVIRONMENT");
    else setEnv("ENVIRONMENT", originalEnvironment);
  }
});

test("createInMemoryObjectStore multipart upload - reassembles parts, preserves metadata, and supports resuming", async () => {
  const bucket = createInMemoryObjectStore();
  const upload = await bucket.createMultipartUpload("docs/report.txt", {
    customMetadata: { owner: "alice" },
    httpMetadata: new Headers({
      "content-type": "text/plain",
      "cache-control": "max-age=60",
    }),
    storageClass: "InfrequentAccess",
  });

  const resumed = bucket.resumeMultipartUpload(
    "docs/report.txt",
    upload.uploadId,
  );
  const firstPart = await upload.uploadPart(1, "hello ");
  const secondPart = await resumed.uploadPart(
    2,
    new Uint8Array([119, 111, 114, 108, 100]),
  );

  const completed = await resumed.complete([secondPart, firstPart]);
  assertEquals(completed.key, "docs/report.txt");

  const head = await bucket.head("docs/report.txt");
  assertNotEquals(head, null);
  if (!head) throw new Error("expected completed object metadata");
  assertObjectMatch(head, {
    customMetadata: { owner: "alice" },
    httpMetadata: {
      "cache-control": "max-age=60",
      "content-type": "text/plain",
    },
    storageClass: "InfrequentAccess",
  });

  const stored = await bucket.get("docs/report.txt");
  assertEquals(await stored?.text(), "hello world");
});
test("createInMemoryObjectStore multipart upload - aborts multipart uploads and prevents completion", async () => {
  const bucket = createInMemoryObjectStore();
  const upload = await bucket.createMultipartUpload("docs/aborted.txt");

  const part = await upload.uploadPart(1, "discard me");
  await upload.abort();

  assertThrows(
    () => bucket.resumeMultipartUpload("docs/aborted.txt", upload.uploadId),
    Error,
    "not active",
  );
  await assertRejects(
    async () => {
      await upload.complete([part]);
    },
    Error,
    "not active",
  );
  await assertEquals(await bucket.head("docs/aborted.txt"), null);
});
