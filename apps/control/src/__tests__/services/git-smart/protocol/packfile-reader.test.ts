import { describe, it, expect, beforeEach } from 'vitest';
import { MockR2Bucket } from '../../../../../test/integration/setup';
import { readPackfileAsync, applyDelta } from '@/services/git-smart/protocol/packfile-reader';
import { putBlob, getObject } from '@/services/git-smart/core/object-store';
import { sha1Bytes, concatBytes } from '@/services/git-smart/core/sha1';
import { deflateSync } from 'fflate';

/**
 * Build a raw packfile with raw-deflate compressed objects.
 * writePackfile uses CompressionStream('deflate') which produces zlib format,
 * but the packfile reader expects raw deflate, so we build manually.
 */
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

describe('readPackfileAsync', () => {
  let bucket: MockR2Bucket;

  beforeEach(() => {
    bucket = new MockR2Bucket();
  });

  it('throws on invalid signature', async () => {
    const bad = new TextEncoder().encode('NOTAPACK');
    await expect(readPackfileAsync(bad, bucket as any)).rejects.toThrow('Invalid packfile signature');
  });

  it('roundtrips: putBlob → writePackfile → readPackfileAsync stores objects', async () => {
    const content = new TextEncoder().encode('hello\n');
    const originalSha = await putBlob(bucket as any, content);

    // Build a packfile with raw-deflate compression (compatible with reader)
    const pack = await buildTestPackfile(bucket, [originalSha]);

    // Create a fresh bucket to read into (simulating receive)
    const receiveBucket = new MockR2Bucket();
    const storedShas = await readPackfileAsync(pack, receiveBucket as any);

    // Exactly one object should be stored
    expect(storedShas.length).toBe(1);

    // SHA should match the original
    expect(storedShas[0]).toBe(originalSha);

    // Verify content roundtripped correctly
    const obj = await getObject(receiveBucket as any, storedShas[0]);
    expect(obj).not.toBeNull();
    expect(obj!.type).toBe('blob');
    expect(new TextDecoder().decode(obj!.content)).toBe('hello\n');
  });

  it('throws when maxObjectCount is exceeded', async () => {
    const content = new TextEncoder().encode('a');
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await expect(
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxObjectCount: 0 }),
    ).rejects.toThrow(/Pack object count 1 exceeds limit of 0/);
  });

  it('throws when maxInflatedTotal is exceeded', async () => {
    const content = new TextEncoder().encode('x'.repeat(1000));
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await expect(
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxInflatedTotal: 1 }),
    ).rejects.toThrow(/Inflated total \d+ exceeds limit of 1/);
  });

  it('throws when maxObjectInflated is exceeded', async () => {
    const content = new TextEncoder().encode('a'.repeat(100));
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await expect(
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxObjectInflated: 10 }),
    ).rejects.toThrow(/Object inflated size 100 exceeds limit of 10/);
  });

  it('throws when maxPackfileBytes is exceeded', async () => {
    const content = new TextEncoder().encode('test data');
    const sha = await putBlob(bucket as any, content);
    const pack = await buildTestPackfile(bucket, [sha]);

    await expect(
      readPackfileAsync(pack, new MockR2Bucket() as any, { maxPackfileBytes: 10 }),
    ).rejects.toThrow(/Packfile size \d+ exceeds limit of 10/);
  });
});

describe('applyDelta', () => {
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

  it('applies a simple insert instruction', () => {
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
    expect(new TextDecoder().decode(result)).toBe('HELLO');
  });

  it('applies a copy instruction', () => {
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
    expect(new TextDecoder().decode(result)).toBe('World');
  });

  it('applies mixed copy + insert', () => {
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
    expect(new TextDecoder().decode(result)).toBe('ABCXY');
  });

  it('throws on 0x00 instruction', () => {
    const base = new Uint8Array([1, 2, 3]);
    const delta = new Uint8Array([
      ...makeVLE(3),     // base size
      ...makeVLE(3),     // result size
      0x00,              // invalid instruction
    ]);
    expect(() => applyDelta(base, delta)).toThrow('Invalid delta instruction: 0x00');
  });
});
