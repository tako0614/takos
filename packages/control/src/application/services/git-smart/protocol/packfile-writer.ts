/**
 * Packfile writer — generates a git packfile from a list of object SHAs.
 *
 * Format:
 *   - Header: "PACK" + version(2) + object_count(4 bytes BE)
 *   - Objects: type+size VLE header + zlib-deflated content
 *   - Trailer: SHA-1 checksum of entire pack
 *
 * Phase 1: No delta compression (undeltified objects only).
 */

import type { R2Bucket } from "../../../../shared/types/bindings.ts";
import {
  concatBytes,
  type hexFromBuffer as _hexFromBuffer,
  sha1Bytes,
} from "../core/sha1.ts";
import { getObject } from "../core/object-store.ts";
import type { GitObjectType } from "../git-objects.ts";

const PACK_SIGNATURE = new Uint8Array([0x50, 0x41, 0x43, 0x4B]); // "PACK"
const PACK_VERSION = 2;

const TYPE_NUMBERS: Record<GitObjectType, number> = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
};

function encodeUint32BE(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (n >>> 24) & 0xFF;
  buf[1] = (n >>> 16) & 0xFF;
  buf[2] = (n >>> 8) & 0xFF;
  buf[3] = n & 0xFF;
  return buf;
}

/**
 * Encode the type+size VLE header for an undeltified packfile object.
 * Format: first byte = (type << 4) | (size & 0x0F), MSB continuation bit.
 * Subsequent bytes: 7 bits of size each, MSB continuation.
 */
function encodeObjectHeader(typeNum: number, size: number): Uint8Array {
  const bytes: number[] = [];
  let firstByte = (typeNum << 4) | (size & 0x0F);
  size >>= 4;

  if (size > 0) {
    firstByte |= 0x80;
  }
  bytes.push(firstByte);

  while (size > 0) {
    let byte = size & 0x7F;
    size >>= 7;
    if (size > 0) byte |= 0x80;
    bytes.push(byte);
  }

  return new Uint8Array(bytes);
}

async function deflateData(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(data.slice().buffer as ArrayBuffer);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatBytes(...chunks);
}

/**
 * Write a packfile containing the given objects.
 * Returns the complete packfile as a Uint8Array.
 */
export async function writePackfile(
  bucket: R2Bucket,
  shas: string[],
): Promise<Uint8Array> {
  if (shas.length === 0) {
    // Return empty packfile
    const header = concatBytes(
      PACK_SIGNATURE,
      encodeUint32BE(PACK_VERSION),
      encodeUint32BE(0),
    );
    const checksum = new Uint8Array(await sha1Bytes(header));
    return concatBytes(header, checksum);
  }

  const parts: Uint8Array[] = [];

  // Pack header
  const header = concatBytes(
    PACK_SIGNATURE,
    encodeUint32BE(PACK_VERSION),
    encodeUint32BE(shas.length),
  );
  parts.push(header);

  // Objects
  for (const sha of shas) {
    const obj = await getObject(bucket, sha);
    if (!obj) {
      throw new Error(`Object not found: ${sha}`);
    }

    const typeNum = TYPE_NUMBERS[obj.type];
    if (typeNum === undefined) {
      throw new Error(`Unknown object type: ${obj.type}`);
    }

    const objHeader = encodeObjectHeader(typeNum, obj.content.length);
    const compressed = await deflateData(obj.content);

    parts.push(objHeader, compressed);
  }

  // Calculate SHA-1 checksum of everything
  const packWithoutChecksum = concatBytes(...parts);
  const checksum = new Uint8Array(await sha1Bytes(packWithoutChecksum));

  return concatBytes(packWithoutChecksum, checksum);
}
