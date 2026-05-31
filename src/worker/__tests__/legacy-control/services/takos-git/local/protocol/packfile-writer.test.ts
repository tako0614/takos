import { MockObjectStoreBinding } from "../../../../../../test/integration/setup.ts";
import { writePackfile } from "@/application/services/takos-git/local/protocol/packfile-writer.ts";
import { putBlob } from "@/application/services/takos-git/local/core/object-store.ts";
import { sha1Bytes } from "@/application/services/takos-git/local/core/sha1.ts";

import { assertEquals, assertRejects } from "@std/assert";

let bucket: MockObjectStoreBinding;

Deno.test("writePackfile - produces a valid empty packfile", async () => {
  bucket = new MockObjectStoreBinding();
  const pack = await writePackfile(bucket, []);

  // Header: "PACK" (4) + version (4) + count (4) = 12 bytes + 20 SHA-1 trailer = 32
  assertEquals(pack.length, 32);

  // Signature
  const sig = new TextDecoder().decode(pack.subarray(0, 4));
  assertEquals(sig, "PACK");

  // Version 2
  const version = (pack[4] << 24) | (pack[5] << 16) | (pack[6] << 8) | pack[7];
  assertEquals(version, 2);

  // Object count 0
  const count = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];
  assertEquals(count, 0);

  // Verify SHA-1 trailer
  const headerBytes = pack.subarray(0, 12);
  const expectedChecksum = new Uint8Array(await sha1Bytes(headerBytes));
  assertEquals(pack.subarray(12), expectedChecksum);
});

Deno.test("writePackfile - writes a single blob and produces valid packfile", async () => {
  bucket = new MockObjectStoreBinding();
  const content = new TextEncoder().encode("hello world\n");
  const sha = await putBlob(bucket, content);

  const pack = await writePackfile(bucket, [sha]);

  // Signature
  assertEquals(new TextDecoder().decode(pack.subarray(0, 4)), "PACK");

  // Version 2
  const version = (pack[4] << 24) | (pack[5] << 16) | (pack[6] << 8) | pack[7];
  assertEquals(version, 2);

  // Object count 1
  const count = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];
  assertEquals(count, 1);

  // SHA-1 trailer is last 20 bytes
  const trailer = pack.subarray(pack.length - 20);
  const packBody = pack.subarray(0, pack.length - 20);
  const expectedChecksum = new Uint8Array(await sha1Bytes(packBody));
  assertEquals(trailer, expectedChecksum);
});

Deno.test("writePackfile - throws on missing object", async () => {
  bucket = new MockObjectStoreBinding();
  const fakeSha = "a".repeat(40);
  await assertRejects(async () => {
    await writePackfile(bucket, [fakeSha]);
  }, "Object not found");
});
