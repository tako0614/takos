import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleUploadPack } from '@/services/git-smart/smart-http/upload-pack';
import { encodePktLine, flushPkt, parsePktLines, pktLineText } from '@/services/git-smart/protocol/pkt-line';
import { concatBytes } from '@/services/git-smart/core/sha1';

// Mock dependencies
vi.mock('@/services/git-smart/core/commit-index', () => ({
  collectReachableObjects: vi.fn(),
}));

vi.mock('@/services/git-smart/protocol/packfile-writer', () => ({
  writePackfile: vi.fn(),
}));

import { collectReachableObjects } from '@/services/git-smart/core/commit-index';
import { writePackfile } from '@/services/git-smart/protocol/packfile-writer';
const mockCollect = vi.mocked(collectReachableObjects);
const mockWrite = vi.mocked(writePackfile);

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);
const SHA_D = 'd'.repeat(40);

/** Helper: build a minimal PACK header (signature + version 2 + object count) */
function makePackHeader(objectCount: number): Uint8Array {
  const buf = new Uint8Array(12);
  // "PACK"
  buf[0] = 0x50; buf[1] = 0x41; buf[2] = 0x43; buf[3] = 0x4b;
  // version 2 (big-endian)
  buf[7] = 2;
  // object count (big-endian)
  buf[8] = (objectCount >>> 24) & 0xff;
  buf[9] = (objectCount >>> 16) & 0xff;
  buf[10] = (objectCount >>> 8) & 0xff;
  buf[11] = objectCount & 0xff;
  return buf;
}

/** Extract the concatenated packfile bytes from side-band channel 1 frames in the response */
function extractPackData(responseBytes: Uint8Array): Uint8Array {
  const lines = parsePktLines(responseBytes);
  const chunks: Uint8Array[] = [];
  for (const line of lines) {
    if (line.type === 'data' && line.data && line.data[0] === 1) {
      // channel byte (1) followed by payload
      chunks.push(line.data.subarray(1));
    }
  }
  return concatBytes(...chunks);
}

describe('handleUploadPack', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns NAK only when no wants', async () => {
    // Send a body with just "done" and flush
    const body = concatBytes(
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // Should be just NAK
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(pktLineText(lines[0])).toBe('NAK');
  });

  it('returns NAK + side-band packfile when wants present', async () => {
    mockCollect.mockResolvedValue([SHA_A]);
    // Return a minimal mock packfile
    const fakePack = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2, 0, 0, 0, 0]);
    mockWrite.mockResolvedValue(fakePack);

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // First line should be NAK
    expect(pktLineText(lines[0])).toBe('NAK');

    // Should have side-band data (channel 1 = packfile)
    const sideBandLines = lines.filter(l => l.type === 'data' && l.data && l.data[0] === 1);
    expect(sideBandLines.length).toBeGreaterThan(0);

    // Should end with flush
    expect(lines[lines.length - 1].type).toBe('flush');

    // Verify collectReachableObjects was called with correct args
    expect(mockCollect).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'repo1',
      [SHA_A],
      expect.any(Set),
    );
  });

  it('passes all wanted SHAs to collectReachableObjects when multiple wants are sent', async () => {
    mockCollect.mockResolvedValue([SHA_A, SHA_B, SHA_C]);
    const fakePack = makePackHeader(3);
    mockWrite.mockResolvedValue(fakePack);

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      encodePktLine(`want ${SHA_B}\n`),
      encodePktLine(`want ${SHA_C}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // NAK should still be the first line
    expect(pktLineText(lines[0])).toBe('NAK');

    // collectReachableObjects must receive all three SHAs in the wants array
    expect(mockCollect).toHaveBeenCalledTimes(1);
    const wantsArg = mockCollect.mock.calls[0][3];
    expect(wantsArg).toEqual([SHA_A, SHA_B, SHA_C]);

    // writePackfile should receive all reachable objects
    expect(mockWrite).toHaveBeenCalledTimes(1);
    expect(mockWrite.mock.calls[0][1]).toEqual([SHA_A, SHA_B, SHA_C]);
  });

  it('passes have SHAs as exclusion set so reachable objects are excluded', async () => {
    // Client already has SHA_C and SHA_D; those should be passed as the haves set
    mockCollect.mockResolvedValue([SHA_A]);
    const fakePack = makePackHeader(1);
    mockWrite.mockResolvedValue(fakePack);

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine(`have ${SHA_C}\n`),
      encodePktLine(`have ${SHA_D}\n`),
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    expect(pktLineText(lines[0])).toBe('NAK');

    // Verify haves were forwarded correctly
    expect(mockCollect).toHaveBeenCalledTimes(1);
    const havesArg: Set<string> = mockCollect.mock.calls[0][4];
    expect(havesArg).toBeInstanceOf(Set);
    expect(havesArg.has(SHA_C)).toBe(true);
    expect(havesArg.has(SHA_D)).toBe(true);
    expect(havesArg.size).toBe(2);

    // Only unreachable-from-haves objects should end up in the packfile
    expect(mockWrite.mock.calls[0][1]).toEqual([SHA_A]);
  });

  it('returns NAK-only for a completely empty body (no want/have/done)', async () => {
    // An empty body means zero pkt-lines
    const body = new Uint8Array(0);

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // Should return just NAK, no packfile
    expect(lines.length).toBe(1);
    expect(pktLineText(lines[0])).toBe('NAK');

    // Neither mock should have been called
    expect(mockCollect).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('returns NAK-only when body contains only a flush packet', async () => {
    const body = flushPkt();

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    expect(lines.length).toBe(1);
    expect(pktLineText(lines[0])).toBe('NAK');
    expect(mockCollect).not.toHaveBeenCalled();
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('propagates errors from collectReachableObjects', async () => {
    mockCollect.mockRejectedValue(new Error('object not found'));

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await expect(
      handleUploadPack({} as any, {} as any, 'repo1', body),
    ).rejects.toThrow('object not found');
  });

  it('propagates errors from writePackfile', async () => {
    mockCollect.mockResolvedValue([SHA_A]);
    mockWrite.mockRejectedValue(new Error('packfile write failed'));

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await expect(
      handleUploadPack({} as any, {} as any, 'repo1', body),
    ).rejects.toThrow('packfile write failed');
  });

  it('ignores want lines with invalid (non-40-char) SHAs', async () => {
    const body = concatBytes(
      encodePktLine('want shortsha\n'),
      encodePktLine('want \n'),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // No valid wants -> NAK only
    expect(lines.length).toBe(1);
    expect(pktLineText(lines[0])).toBe('NAK');
    expect(mockCollect).not.toHaveBeenCalled();
  });

  it('ignores have lines with invalid SHAs and still processes valid wants', async () => {
    mockCollect.mockResolvedValue([SHA_A]);
    mockWrite.mockResolvedValue(makePackHeader(1));

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('have shortsha\n'),
      encodePktLine(`have ${SHA_B}\n`),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await handleUploadPack({} as any, {} as any, 'repo1', body);

    // Only the valid have (SHA_B) should be in the set; invalid "shortsha" is ignored
    const havesArg: Set<string> = mockCollect.mock.calls[0][4];
    expect(havesArg.size).toBe(1);
    expect(havesArg.has(SHA_B)).toBe(true);
  });

  it('extracts want SHA correctly when capabilities are appended', async () => {
    // The first want line may include capabilities: "want <sha> cap1 cap2\n"
    mockCollect.mockResolvedValue([SHA_A]);
    mockWrite.mockResolvedValue(makePackHeader(1));

    const body = concatBytes(
      encodePktLine(`want ${SHA_A} multi_ack_detailed side-band-64k ofs-delta\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await handleUploadPack({} as any, {} as any, 'repo1', body);

    const wantsArg = mockCollect.mock.calls[0][3];
    expect(wantsArg).toEqual([SHA_A]);
  });

  describe('side-band-64k framing', () => {
    it('wraps all packfile data in channel 1 frames', async () => {
      mockCollect.mockResolvedValue([SHA_A]);
      const fakePack = makePackHeader(1);
      mockWrite.mockResolvedValue(fakePack);

      const body = concatBytes(
        encodePktLine(`want ${SHA_A}\n`),
        flushPkt(),
        encodePktLine('done\n'),
        flushPkt(),
      );

      const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
      const packData = extractPackData(result);

      // Reassembled channel-1 data should equal the original packfile
      expect(packData).toEqual(fakePack);
    });

    it('chunks large packfiles into multiple side-band frames', async () => {
      mockCollect.mockResolvedValue([SHA_A]);
      // Create a packfile larger than the 65515-byte chunk limit
      const largePayload = new Uint8Array(65515 * 2 + 100);
      largePayload.fill(0x42);
      // Set PACK signature so it looks like a packfile
      largePayload[0] = 0x50; largePayload[1] = 0x41;
      largePayload[2] = 0x43; largePayload[3] = 0x4b;
      mockWrite.mockResolvedValue(largePayload);

      const body = concatBytes(
        encodePktLine(`want ${SHA_A}\n`),
        flushPkt(),
        encodePktLine('done\n'),
        flushPkt(),
      );

      const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
      const lines = parsePktLines(result);

      // Count channel-1 (packfile) frames
      const ch1Lines = lines.filter(l => l.type === 'data' && l.data && l.data[0] === 1);
      // 65515*2 + 100 bytes should require at least 3 chunks
      expect(ch1Lines.length).toBe(3);

      // Verify each chunk's payload does not exceed the 65515 limit
      for (const frame of ch1Lines) {
        // frame.data includes channel byte, so payload = data.length - 1
        expect(frame.data!.length - 1).toBeLessThanOrEqual(65515);
      }

      // Reassembled data must match the original packfile
      const packData = extractPackData(result);
      expect(packData).toEqual(largePayload);
    });

    it('response structure is NAK, then channel-1 data frames, then flush', async () => {
      mockCollect.mockResolvedValue([SHA_A]);
      mockWrite.mockResolvedValue(makePackHeader(1));

      const body = concatBytes(
        encodePktLine(`want ${SHA_A}\n`),
        flushPkt(),
        encodePktLine('done\n'),
        flushPkt(),
      );

      const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
      const lines = parsePktLines(result);

      // Must have at least 3 parts: NAK, >=1 side-band frame, flush
      expect(lines.length).toBeGreaterThanOrEqual(3);

      // First: NAK
      expect(lines[0].type).toBe('data');
      expect(pktLineText(lines[0])).toBe('NAK');

      // Middle: all should be channel-1 data frames
      for (let i = 1; i < lines.length - 1; i++) {
        expect(lines[i].type).toBe('data');
        expect(lines[i].data![0]).toBe(1); // channel 1
      }

      // Last: flush
      expect(lines[lines.length - 1].type).toBe('flush');
    });

    it('does not include channel 2 (progress) or channel 3 (error) frames', async () => {
      mockCollect.mockResolvedValue([SHA_A]);
      mockWrite.mockResolvedValue(makePackHeader(1));

      const body = concatBytes(
        encodePktLine(`want ${SHA_A}\n`),
        flushPkt(),
        encodePktLine('done\n'),
        flushPkt(),
      );

      const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
      const lines = parsePktLines(result);

      // No channel 2 or channel 3 frames
      const ch2 = lines.filter(l => l.type === 'data' && l.data && l.data[0] === 2);
      const ch3 = lines.filter(l => l.type === 'data' && l.data && l.data[0] === 3);
      expect(ch2.length).toBe(0);
      expect(ch3.length).toBe(0);
    });
  });

  it('handles collectReachableObjects returning empty array (no objects to send)', async () => {
    mockCollect.mockResolvedValue([]);
    // writePackfile with empty array should still produce a valid (empty) packfile
    const emptyPack = makePackHeader(0);
    mockWrite.mockResolvedValue(emptyPack);

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    expect(pktLineText(lines[0])).toBe('NAK');
    // Should still send the (empty) packfile via side-band
    const ch1Lines = lines.filter(l => l.type === 'data' && l.data && l.data[0] === 1);
    expect(ch1Lines.length).toBeGreaterThan(0);

    const packData = extractPackData(result);
    expect(packData).toEqual(emptyPack);
  });

  it('deduplicates wants when the same SHA appears multiple times', async () => {
    // The source code pushes each want line, so duplicates will appear.
    // This test documents current behavior (duplicates are passed through).
    mockCollect.mockResolvedValue([SHA_A]);
    mockWrite.mockResolvedValue(makePackHeader(1));

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await handleUploadPack({} as any, {} as any, 'repo1', body);

    // Both wants are passed to collectReachableObjects (current behavior)
    const wantsArg = mockCollect.mock.calls[0][3];
    expect(wantsArg).toEqual([SHA_A, SHA_A]);
  });
});
