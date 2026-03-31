/**
 * Git Smart HTTP — upload-pack (clone/fetch).
 *
 * 1. Parse client's want/have lines
 * 2. Compute objects to send (want reachable - have reachable)
 * 3. Generate packfile
 * 4. Send response with side-band-64k framing
 */

import type { D1Database, R2Bucket } from '../../../../shared/types/bindings.ts';
import { parsePktLines, pktLineText, encodePktLine, encodeSideBandData, flushPkt } from '../protocol/pkt-line.ts';
import { collectReachableObjects } from '../core/commit-index.ts';
import { writePackfile } from '../protocol/packfile-writer.ts';
import { concatBytes } from '../core/sha1.ts';

export async function handleUploadPack(
  db: D1Database,
  bucket: R2Bucket,
  repoId: string,
  body: Uint8Array,
): Promise<Uint8Array> {
  const lines = parsePktLines(body);

  const wants: string[] = [];
  const haves = new Set<string>();
  let done = false;

  for (const line of lines) {
    if (line.type !== 'data' || !line.data) continue;
    const text = pktLineText(line);

    if (text.startsWith('want ')) {
      // "want <sha> [capabilities]"
      const sha = text.split(' ')[1];
      if (sha && sha.length === 40) wants.push(sha);
    } else if (text.startsWith('have ')) {
      const sha = text.split(' ')[1];
      if (sha && sha.length === 40) haves.add(sha);
    } else if (text === 'done') {
      done = true;
    }
  }

  if (wants.length === 0) {
    // Nothing requested
    return encodePktLine('NAK\n');
  }

  // Collect objects to send
  const objectShas = await collectReachableObjects(db, bucket, repoId, wants, haves);

  // Build packfile
  const packfile = await writePackfile(bucket, objectShas);

  // Build response with side-band-64k framing
  const parts: Uint8Array[] = [];

  // NAK (no common base in simple case)
  parts.push(encodePktLine('NAK\n'));

  // Send packfile data in chunks via side-band channel 1
  const CHUNK_SIZE = 65515; // 65520 - 5 (pkt-line overhead + channel byte)
  for (let i = 0; i < packfile.length; i += CHUNK_SIZE) {
    const chunk = packfile.subarray(i, Math.min(i + CHUNK_SIZE, packfile.length));
    parts.push(encodeSideBandData(1, chunk));
  }

  // Flush
  parts.push(flushPkt());

  return concatBytes(...parts);
}
