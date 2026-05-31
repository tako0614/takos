import { test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { createPersistentObjectStore } from "../persistent-r2.ts";
import { removeLocalDataDir } from "../persistent-shared.ts";

import {
  assertEquals,
  assertNotEquals,
  assertObjectMatch,
  assertRejects,
} from "@std/assert";

const tempDirs: string[] = [];

async function createBucketFile(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "takos-persistent-r2-"));
  tempDirs.push(tempDir);
  return path.join(tempDir, "bucket.json");
}

test("createPersistentObjectStore multipart upload - reassembles parts, preserves metadata, and supports resuming across adapter reloads", async () => {
  try {
    const filePath = await createBucketFile();
    const firstBucket = createPersistentObjectStore(filePath);
    const upload = await firstBucket.createMultipartUpload("docs/report.txt", {
      customMetadata: { owner: "alice" },
      httpMetadata: new Headers({
        "content-type": "text/plain",
        "cache-control": "max-age=60",
      }),
      storageClass: "InfrequentAccess",
    });

    const firstPart = await upload.uploadPart(1, "hello ");

    const secondBucket = createPersistentObjectStore(filePath);
    const resumed = secondBucket.resumeMultipartUpload(
      "docs/report.txt",
      upload.uploadId,
    );
    const secondPart = await resumed.uploadPart(
      2,
      new Uint8Array([119, 111, 114, 108, 100]),
    );

    const completed = await resumed.complete([secondPart, firstPart]);
    assertEquals(completed.key, "docs/report.txt");

    const reloadedBucket = createPersistentObjectStore(filePath);
    const head = await reloadedBucket.head("docs/report.txt");
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

    const stored = await reloadedBucket.get("docs/report.txt");
    assertEquals(await stored?.text(), "hello world");
  } finally {
    await Promise.all(tempDirs.splice(0).map((dir) => removeLocalDataDir(dir)));
  }
});
test("createPersistentObjectStore multipart upload - aborts multipart uploads and prevents later part uploads after adapter reload", async () => {
  try {
    const filePath = await createBucketFile();
    const firstBucket = createPersistentObjectStore(filePath);
    const upload = await firstBucket.createMultipartUpload("docs/aborted.txt");

    await upload.uploadPart(1, "discard me");
    await upload.abort();

    const reloadedBucket = createPersistentObjectStore(filePath);
    const resumed = reloadedBucket.resumeMultipartUpload(
      "docs/aborted.txt",
      upload.uploadId,
    );

    await assertRejects(
      async () => {
        await resumed.uploadPart(1, "discard me");
      },
      Error,
      "not active",
    );
    await assertEquals(await reloadedBucket.head("docs/aborted.txt"), null);
  } finally {
    await Promise.all(tempDirs.splice(0).map((dir) => removeLocalDataDir(dir)));
  }
});
