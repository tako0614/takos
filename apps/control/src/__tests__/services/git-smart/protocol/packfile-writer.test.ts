import { describe, it, expect, beforeEach } from 'vitest';
import { MockR2Bucket } from '../../../../../test/integration/setup';
import { writePackfile } from '@/services/git-smart/protocol/packfile-writer';
import { putBlob } from '@/services/git-smart/core/object-store';
import { sha1Bytes } from '@/services/git-smart/core/sha1';

describe('writePackfile', () => {
  let bucket: MockR2Bucket;

  beforeEach(() => {
    bucket = new MockR2Bucket();
  });

  it('produces a valid empty packfile', async () => {
    const pack = await writePackfile(bucket as any, []);

    // Header: "PACK" (4) + version (4) + count (4) = 12 bytes + 20 SHA-1 trailer = 32
    expect(pack.length).toBe(32);

    // Signature
    const sig = new TextDecoder().decode(pack.subarray(0, 4));
    expect(sig).toBe('PACK');

    // Version 2
    const version = (pack[4] << 24) | (pack[5] << 16) | (pack[6] << 8) | pack[7];
    expect(version).toBe(2);

    // Object count 0
    const count = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];
    expect(count).toBe(0);

    // Verify SHA-1 trailer
    const headerBytes = pack.subarray(0, 12);
    const expectedChecksum = new Uint8Array(await sha1Bytes(headerBytes));
    expect(pack.subarray(12)).toEqual(expectedChecksum);
  });

  it('writes a single blob and produces valid packfile', async () => {
    const content = new TextEncoder().encode('hello world\n');
    const sha = await putBlob(bucket as any, content);

    const pack = await writePackfile(bucket as any, [sha]);

    // Signature
    expect(new TextDecoder().decode(pack.subarray(0, 4))).toBe('PACK');

    // Version 2
    const version = (pack[4] << 24) | (pack[5] << 16) | (pack[6] << 8) | pack[7];
    expect(version).toBe(2);

    // Object count 1
    const count = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];
    expect(count).toBe(1);

    // SHA-1 trailer is last 20 bytes
    const trailer = pack.subarray(pack.length - 20);
    const packBody = pack.subarray(0, pack.length - 20);
    const expectedChecksum = new Uint8Array(await sha1Bytes(packBody));
    expect(trailer).toEqual(expectedChecksum);
  });

  it('throws on missing object', async () => {
    const fakeSha = 'a'.repeat(40);
    await expect(writePackfile(bucket as any, [fakeSha])).rejects.toThrow('Object not found');
  });
});
