import { MockR2Bucket } from '../../../../../test/integration/setup.ts';
import { readPackfileAsync, applyDelta } from '@/services/git-smart/protocol/packfile-reader';
import { putBlob, getObject } from '@/services/git-smart/core/object-store';
import { sha1Bytes, concatBytes } from '@/services/git-smart/core/sha1';
import { deflateSync } from 'fflate';

/**
 * Build a raw packfile with raw-deflate compressed objects.
 * writePackfile uses CompressionStream('deflate') which produces zlib format,
 * but the packfile reader expects raw deflate, so we build manually.
 */
import { assertEquals, assertNotEquals, assertThrows, assertRejects } from 'jsr:@std/assert';

async function buildTestPackfile(bucket: MockR2Bucket, shas: string[]): Promise<Uint8Array> {
  const PACK_SIG = new Uint8Array([0x50, 0x41, 0x43, 0x4B]);
  const encU32 = (n: number) => {
    const b = new Uint8Array(4);
    b[0] = (n >>> 24) & 0xFF;
    b[1] = (n >>> 16) & 0xFF;
    b[2] = (n >>> 8) & 0xFF;
    b[3] = n & 0xFF;
    return b;
  };
  const encObjHeader = (typeNum: number, size: number) => {
    const bytes: number[] = [];
    let fb = (typeNum << 4) | (size & 0x0F);
    size >>= 4;
    if (size > 0) fb |= 0x80;
    bytes.push(fb);
    while (size > 0) {
      let b = size & 0x7F;
      size >>= 7;
      if (size > 0) b |= 0x80;
      bytes.push(b);
    }
    return new Uint8Array(bytes);
  };

  const parts: Uint8Array[] = [];
  parts.push(concatBytes(PACK_SIG, encU32(2), encU32(shas.length)));

  const TYPE_NUMS: Record<string, number> = { commit: 1, tree: 2, blob: 3, tag: 4 };
  for (const sha of shas) {
    const obj = await getObject(bucket as any, sha);
    if (!obj) throw new Error(`Object not found: ${sha}`);
    const hdr = encObjHeader(TYPE_NUMS[obj.type], obj.content.length);
    const compressed = deflateSync(obj.content);
    parts.push(hdr, compressed);
  }

  const packNoChecksum = concatBytes(...parts);
  const checksum = new Uint8Array(await sha1Bytes(packNoChecksum));
  return concatBytes(packNoChecksum, checksum);
}


  let bucket: MockR2Bucket;

  Deno.test('readPackfileAsync - throws on invalid signature', async () => {
  bucket = new MockR2Bucket();
  const bad = new TextEncoder().encode('NOTAPACK');
    await await assertRejects(async () => { await readPackfileAsync(bad, bucket as any); }, 'Invalid packfile signature');
})

  Deno.test('readPackfileAsync - roundtrips: putBlob → writePackfile → readPackfileAsync stores objects', async () => {
  bucket = new MockR2Bucket();
  const content = new TextEncoder().encode('hello\n');
    const originalSha = await putBlob(bucket as any, content);

    // Build a packfile with raw-deflate compression (compatible with reader)
    const pack = await buildTestPackfile(bucket, [originalSha]);

    // Create a fresh bucket to read into (simulating receive)
    const receiveBucket = new MockR2Bucket();
    const storedShas = await readPackfileAsync(pack, receiveBucket as any);

    // Exactly one object should be stored
    assertEquals(storedShas.length, 1);

    // SHA should match the original
    assertEquals(storedShas[0], originalSha);

    // Verify content roundtripped correctly
    const obj = await getObject(receiveBucket as any, storedShas[0]);
    assertNotEquals(obj, null);
    assertEquals(obj!.type, 'blob');
    assertEquals(new TextDecoder().decode(obj!.content), 'hello\n');
})

  Deno.test('readPackfileAsync - throws when maxObjectCount is exceeded', async () => {
  bucket = new MockR2Bucket();
  const content = new TextEncoder().encode('a');
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await await assertRejects(async () => { await 
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxObjectCount: 0 }),
    ; }, /Pack object count 1 exceeds limit of 0/);
})

  Deno.test('readPackfileAsync - throws when maxInflatedTotal is exceeded', async () => {
  bucket = new MockR2Bucket();
  const content = new TextEncoder().encode('x'.repeat(1000));
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await await assertRejects(async () => { await 
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxInflatedTotal: 1 }),
    ; }, /Inflated total \d+ exceeds limit of 1/);
})

  Deno.test('readPackfileAsync - throws when maxObjectInflated is exceeded', async () => {
  bucket = new MockR2Bucket();
  const content = new TextEncoder().encode('a'.repeat(100));
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await await assertRejects(async () => { await 
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxObjectInflated: 10 }),
    ; }, /Object inflated size 100 exceeds limit of 10/);
})

  Deno.test('readPackfileAsync - throws when maxPackfileBytes is exceeded', async () => {
  bucket = new MockR2Bucket();
  const content = new TextEncoder().encode('test data');
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await await assertRejects(async () => { await 
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxPackfileBytes: 10 }),
    ; }, /Packfile size \d+ exceeds limit of 10/);
})



  function makeVLE(n: number): number[] {
    const bytes: number[] = [];
    let value = n;
    while (value >= 0x80) {
      bytes.push((value & 0x7f) | 0x80);
      value >>= 7;
    }
    bytes.push(value);
    return bytes;
  }

  Deno.test('applyDelta - applies a simple insert instruction', () => {
  const base = new Uint8Array([0x41, 0x42, 0x43]); // "ABC"
    // Delta: base size=3, result size=5, insert 5 bytes "HELLO"
    const insertData = [0x48, 0x45, 0x4c, 0x4c, 0x4f]; // "HELLO"
    const delta = new Uint8Array([
      ...makeVLE(3),     // base size
      ...makeVLE(5),     // result size
      5,                 // insert 5 bytes
      ...insertData,
    ]);
    const result = applyDelta(base, delta);
    assertEquals(new TextDecoder().decode(result), 'HELLO');
})

  Deno.test('applyDelta - applies a copy instruction', () => {
  const base = new TextEncoder().encode('Hello, World!');
    // Copy 5 bytes from offset 7 ("World")
    const delta = new Uint8Array([
      ...makeVLE(13),    // base size
      ...makeVLE(5),     // result size
      // copy cmd: 0x80 | 0x01 (offset byte 0) | 0x10 (size byte 0)
      0x80 | 0x01 | 0x10,
      7,                 // offset = 7
      5,                 // size = 5
    ]);
    const result = applyDelta(base, delta);
    assertEquals(new TextDecoder().decode(result), 'World');
})

  Deno.test('applyDelta - applies mixed copy + insert', () => {
  const base = new TextEncoder().encode('ABCDEF');
    // Result: "ABC" (copy from base 0,3) + "XY" (insert 2 bytes)
    const delta = new Uint8Array([
      ...makeVLE(6),     // base size
      ...makeVLE(5),     // result size
      // copy: offset=0, size=3
      0x80 | 0x01 | 0x10,
      0,                 // offset = 0
      3,                 // size = 3
      // insert 2 bytes: "XY"
      2,
      0x58, 0x59,        // "XY"
    ]);
    const result = applyDelta(base, delta);
    assertEquals(new TextDecoder().decode(result), 'ABCXY');
})

  Deno.test('applyDelta - throws on 0x00 instruction', () => {
  const base = new Uint8Array([1, 2, 3]);
    const delta = new Uint8Array([
      ...makeVLE(3),     // base size
      ...makeVLE(3),     // result size
      0x00,              // invalid instruction
    ]);
    assertThrows(() => { () => applyDelta(base, delta); }, 'Invalid delta instruction: 0x00');
})

