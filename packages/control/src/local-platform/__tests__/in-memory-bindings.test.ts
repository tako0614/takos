import { createInMemoryR2Bucket } from "../in-memory-bindings.ts";

import {
  assertEquals,
  assertNotEquals,
  assertObjectMatch,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";

Deno.test("createInMemoryR2Bucket multipart upload - reassembles parts, preserves metadata, and supports resuming", async () => {
  const bucket = createInMemoryR2Bucket();
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
Deno.test("createInMemoryR2Bucket multipart upload - aborts multipart uploads and prevents completion", async () => {
  const bucket = createInMemoryR2Bucket();
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
