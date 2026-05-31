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
} from "@std/assert";

Deno.test("createInMemorySqlDatabase refuses to construct in a production environment", () => {
  const originalEnvironment = Deno.env.get("ENVIRONMENT");
  const originalVitest = Deno.env.get("VITEST");
  const originalDenoTest = Deno.env.get("DENO_TEST");
  // Clear test signals so the production guard is reachable.
  Deno.env.delete("VITEST");
  Deno.env.delete("DENO_TEST");
  Deno.env.set("ENVIRONMENT", "production");
  try {
    assertThrows(
      () => createInMemorySqlDatabase(),
      Error,
      "in-memory SQL database refused",
    );
  } finally {
    if (originalEnvironment === undefined) Deno.env.delete("ENVIRONMENT");
    else Deno.env.set("ENVIRONMENT", originalEnvironment);
    if (originalVitest !== undefined) Deno.env.set("VITEST", originalVitest);
    if (originalDenoTest !== undefined) {
      Deno.env.set("DENO_TEST", originalDenoTest);
    }
  }
});

Deno.test("createInMemorySqlDatabase is allowed (non-production) and is a no-op stub", async () => {
  const originalEnvironment = Deno.env.get("ENVIRONMENT");
  Deno.env.set("ENVIRONMENT", "development");
  try {
    const db = createInMemorySqlDatabase();
    const result = await db.prepare("INSERT INTO t VALUES (1)").run();
    // Honest no-op: write reports no durable change and reads return empty.
    assertEquals(result.meta.changed_db, false);
    assertEquals(result.results, []);
    const read = await db.prepare("SELECT * FROM t").all();
    assertEquals(read.results, []);
  } finally {
    if (originalEnvironment === undefined) Deno.env.delete("ENVIRONMENT");
    else Deno.env.set("ENVIRONMENT", originalEnvironment);
  }
});

Deno.test("createInMemoryObjectStore multipart upload - reassembles parts, preserves metadata, and supports resuming", async () => {
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
Deno.test("createInMemoryObjectStore multipart upload - aborts multipart uploads and prevents completion", async () => {
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
