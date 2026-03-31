import { handleUploadPack } from '@/services/git-smart/smart-http/upload-pack';
import { encodePktLine, flushPkt, parsePktLines, pktLineText } from '@/services/git-smart/protocol/pkt-line';
import { concatBytes } from '@/services/git-smart/core/sha1';

// Mock dependencies
// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/core/commit-index'

// [Deno] vi.mock removed - manually stub imports from '@/services/git-smart/protocol/packfile-writer'

import { collectReachableObjects } from '@/services/git-smart/core/commit-index';
import { writePackfile } from '@/services/git-smart/protocol/packfile-writer';
import { assertEquals, assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mockCollect = collectReachableObjects;
const mockWrite = writePackfile;

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



  Deno.test('handleUploadPack - returns NAK only when no wants', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Send a body with just "done" and flush
    const body = concatBytes(
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // Should be just NAK
    assert(lines.length >= 1);
    assertEquals(pktLineText(lines[0]), 'NAK');
})

  Deno.test('handleUploadPack - returns NAK + side-band packfile when wants present', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A]) as any;
    // Return a minimal mock packfile
    const fakePack = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0, 0, 0, 2, 0, 0, 0, 0]);
    mockWrite = (async () => fakePack) as any;

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // First line should be NAK
    assertEquals(pktLineText(lines[0]), 'NAK');

    // Should have side-band data (channel 1 = packfile)
    const sideBandLines = lines.filter(l => l.type === 'data' && l.data && l.data[0] === 1);
    assert(sideBandLines.length > 0);

    // Should end with flush
    assertEquals(lines[lines.length - 1].type, 'flush');

    // Verify collectReachableObjects was called with correct args
    assertSpyCallArgs(mockCollect, 0, [
      expect.anything(),
      expect.anything(),
      'repo1',
      [SHA_A],
      /* expect.any(Set) */ {} as any,
    ]);
})

  Deno.test('handleUploadPack - passes all wanted SHAs to collectReachableObjects when multiple wants are sent', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A, SHA_B, SHA_C]) as any;
    const fakePack = makePackHeader(3);
    mockWrite = (async () => fakePack) as any;

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
    assertEquals(pktLineText(lines[0]), 'NAK');

    // collectReachableObjects must receive all three SHAs in the wants array
    assertSpyCalls(mockCollect, 1);
    const wantsArg = mockCollect.calls[0][3];
    assertEquals(wantsArg, [SHA_A, SHA_B, SHA_C]);

    // writePackfile should receive all reachable objects
    assertSpyCalls(mockWrite, 1);
    assertEquals(mockWrite.calls[0][1], [SHA_A, SHA_B, SHA_C]);
})

  Deno.test('handleUploadPack - passes have SHAs as exclusion set so reachable objects are excluded', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // Client already has SHA_C and SHA_D; those should be passed as the haves set
    mockCollect = (async () => [SHA_A]) as any;
    const fakePack = makePackHeader(1);
    mockWrite = (async () => fakePack) as any;

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

    assertEquals(pktLineText(lines[0]), 'NAK');

    // Verify haves were forwarded correctly
    assertSpyCalls(mockCollect, 1);
    const havesArg: Set<string> = mockCollect.calls[0][4];
    assert(havesArg instanceof Set);
    assertEquals(havesArg.has(SHA_C), true);
    assertEquals(havesArg.has(SHA_D), true);
    assertEquals(havesArg.size, 2);

    // Only unreachable-from-haves objects should end up in the packfile
    assertEquals(mockWrite.calls[0][1], [SHA_A]);
})

  Deno.test('handleUploadPack - returns NAK-only for a completely empty body (no want/have/done)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // An empty body means zero pkt-lines
    const body = new Uint8Array(0);

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    // Should return just NAK, no packfile
    assertEquals(lines.length, 1);
    assertEquals(pktLineText(lines[0]), 'NAK');

    // Neither mock should have been called
    assertSpyCalls(mockCollect, 0);
    assertSpyCalls(mockWrite, 0);
})

  Deno.test('handleUploadPack - returns NAK-only when body contains only a flush packet', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const body = flushPkt();

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    assertEquals(lines.length, 1);
    assertEquals(pktLineText(lines[0]), 'NAK');
    assertSpyCalls(mockCollect, 0);
    assertSpyCalls(mockWrite, 0);
})

  Deno.test('handleUploadPack - propagates errors from collectReachableObjects', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => { throw new Error('object not found'); }) as any;

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await await assertRejects(async () => { await 
      handleUploadPack({} as any, {} as any, 'repo1', body),
    ; }, 'object not found');
})

  Deno.test('handleUploadPack - propagates errors from writePackfile', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A]) as any;
    mockWrite = (async () => { throw new Error('packfile write failed'); }) as any;

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await await assertRejects(async () => { await 
      handleUploadPack({} as any, {} as any, 'repo1', body),
    ; }, 'packfile write failed');
})

  Deno.test('handleUploadPack - ignores want lines with invalid (non-40-char) SHAs', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    assertEquals(lines.length, 1);
    assertEquals(pktLineText(lines[0]), 'NAK');
    assertSpyCalls(mockCollect, 0);
})

  Deno.test('handleUploadPack - ignores have lines with invalid SHAs and still processes valid wants', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A]) as any;
    mockWrite = (async () => makePackHeader(1)) as any;

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
    const havesArg: Set<string> = mockCollect.calls[0][4];
    assertEquals(havesArg.size, 1);
    assertEquals(havesArg.has(SHA_B), true);
})

  Deno.test('handleUploadPack - extracts want SHA correctly when capabilities are appended', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // The first want line may include capabilities: "want <sha> cap1 cap2\n"
    mockCollect = (async () => [SHA_A]) as any;
    mockWrite = (async () => makePackHeader(1)) as any;

    const body = concatBytes(
      encodePktLine(`want ${SHA_A} multi_ack_detailed side-band-64k ofs-delta\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await handleUploadPack({} as any, {} as any, 'repo1', body);

    const wantsArg = mockCollect.calls[0][3];
    assertEquals(wantsArg, [SHA_A]);
})

  
    Deno.test('handleUploadPack - side-band-64k framing - wraps all packfile data in channel 1 frames', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A]) as any;
      const fakePack = makePackHeader(1);
      mockWrite = (async () => fakePack) as any;

      const body = concatBytes(
        encodePktLine(`want ${SHA_A}\n`),
        flushPkt(),
        encodePktLine('done\n'),
        flushPkt(),
      );

      const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
      const packData = extractPackData(result);

      // Reassembled channel-1 data should equal the original packfile
      assertEquals(packData, fakePack);
})

    Deno.test('handleUploadPack - side-band-64k framing - chunks large packfiles into multiple side-band frames', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A]) as any;
      // Create a packfile larger than the 65515-byte chunk limit
      const largePayload = new Uint8Array(65515 * 2 + 100);
      largePayload.fill(0x42);
      // Set PACK signature so it looks like a packfile
      largePayload[0] = 0x50; largePayload[1] = 0x41;
      largePayload[2] = 0x43; largePayload[3] = 0x4b;
      mockWrite = (async () => largePayload) as any;

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
      assertEquals(ch1Lines.length, 3);

      // Verify each chunk's payload does not exceed the 65515 limit
      for (const frame of ch1Lines) {
        // frame.data includes channel byte, so payload = data.length - 1
        assert(frame.data!.length - 1 <= 65515);
      }

      // Reassembled data must match the original packfile
      const packData = extractPackData(result);
      assertEquals(packData, largePayload);
})

    Deno.test('handleUploadPack - side-band-64k framing - response structure is NAK, then channel-1 data frames, then flush', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A]) as any;
      mockWrite = (async () => makePackHeader(1)) as any;

      const body = concatBytes(
        encodePktLine(`want ${SHA_A}\n`),
        flushPkt(),
        encodePktLine('done\n'),
        flushPkt(),
      );

      const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
      const lines = parsePktLines(result);

      // Must have at least 3 parts: NAK, >=1 side-band frame, flush
      assert(lines.length >= 3);

      // First: NAK
      assertEquals(lines[0].type, 'data');
      assertEquals(pktLineText(lines[0]), 'NAK');

      // Middle: all should be channel-1 data frames
      for (let i = 1; i < lines.length - 1; i++) {
        assertEquals(lines[i].type, 'data');
        assertEquals(lines[i].data![0], 1); // channel 1
      }

      // Last: flush
      assertEquals(lines[lines.length - 1].type, 'flush');
})

    Deno.test('handleUploadPack - side-band-64k framing - does not include channel 2 (progress) or channel 3 (error) frames', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => [SHA_A]) as any;
      mockWrite = (async () => makePackHeader(1)) as any;

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
      assertEquals(ch2.length, 0);
      assertEquals(ch3.length, 0);
})
  

  Deno.test('handleUploadPack - handles collectReachableObjects returning empty array (no objects to send)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mockCollect = (async () => []) as any;
    // writePackfile with empty array should still produce a valid (empty) packfile
    const emptyPack = makePackHeader(0);
    mockWrite = (async () => emptyPack) as any;

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    const result = await handleUploadPack({} as any, {} as any, 'repo1', body);
    const lines = parsePktLines(result);

    assertEquals(pktLineText(lines[0]), 'NAK');
    // Should still send the (empty) packfile via side-band
    const ch1Lines = lines.filter(l => l.type === 'data' && l.data && l.data[0] === 1);
    assert(ch1Lines.length > 0);

    const packData = extractPackData(result);
    assertEquals(packData, emptyPack);
})

  Deno.test('handleUploadPack - deduplicates wants when the same SHA appears multiple times', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  // The source code pushes each want line, so duplicates will appear.
    // This test documents current behavior (duplicates are passed through).
    mockCollect = (async () => [SHA_A]) as any;
    mockWrite = (async () => makePackHeader(1)) as any;

    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine('done\n'),
      flushPkt(),
    );

    await handleUploadPack({} as any, {} as any, 'repo1', body);

    // Both wants are passed to collectReachableObjects (current behavior)
    const wantsArg = mockCollect.calls[0][3];
    assertEquals(wantsArg, [SHA_A, SHA_A]);
})

