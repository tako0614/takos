/**
 * Shared git wire-protocol primitives: packfile object type numbers, the
 * base-128 object header varint, and pkt-line framing.
 *
 * Used by the packfile writer (`pack.ts`, clone/fetch serving), the smart-HTTP
 * serve route, and the remote-fetch client (external import). The packfile
 * reader (`pack-reader.ts`) keeps its own copy of the type numbers so it stays
 * self-contained; keep the two in sync if the git object model ever changes.
 */

import { concatBytes } from "./sha1.ts";
import type { GitObjectType } from "../git-objects.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

/** Packfile object type numbers (git pack format v2). */
export const PACK_OBJ = {
  COMMIT: 1,
  TREE: 2,
  BLOB: 3,
  TAG: 4,
  OFS_DELTA: 6,
  REF_DELTA: 7,
} as const;

const TYPE_TO_NUMBER: Record<GitObjectType, number> = {
  commit: PACK_OBJ.COMMIT,
  tree: PACK_OBJ.TREE,
  blob: PACK_OBJ.BLOB,
  tag: PACK_OBJ.TAG,
};

const NUMBER_TO_TYPE: Record<number, GitObjectType> = {
  [PACK_OBJ.COMMIT]: "commit",
  [PACK_OBJ.TREE]: "tree",
  [PACK_OBJ.BLOB]: "blob",
  [PACK_OBJ.TAG]: "tag",
};

export function gitTypeToNumber(type: GitObjectType): number {
  const n = TYPE_TO_NUMBER[type];
  if (n === undefined) throw new Error(`unknown git object type: ${type}`);
  return n;
}

export function numberToGitType(n: number): GitObjectType {
  const t = NUMBER_TO_TYPE[n];
  if (t === undefined) throw new Error(`not a base git object type: ${n}`);
  return t;
}

/**
 * Encode a packfile object header: 3-bit type + base-128 varint size where the
 * first byte carries the low 4 size bits. `size` is the uncompressed content
 * length and may exceed 2^31 for large blobs, so divide rather than shift.
 */
export function encodePackObjectHeader(type: number, size: number): Uint8Array {
  const bytes: number[] = [];
  let b = (type << 4) | (size & 0x0f);
  size = Math.floor(size / 16);
  while (size > 0) {
    bytes.push(b | 0x80);
    b = size & 0x7f;
    size = Math.floor(size / 128);
  }
  bytes.push(b);
  return new Uint8Array(bytes);
}

// --- pkt-line framing (git smart protocol) ---

/** A flush-pkt ("0000"). */
export const PKT_FLUSH = TEXT_ENCODER.encode("0000");

function toHex4(n: number): string {
  return n.toString(16).padStart(4, "0");
}

/** Frame a payload as a single pkt-line (length prefix includes the 4 header bytes). */
export function pktLine(payload: Uint8Array): Uint8Array {
  const len = payload.length + 4;
  if (len > 0xffff) throw new Error("pkt-line payload too large");
  return concatBytes(TEXT_ENCODER.encode(toHex4(len)), payload);
}

/** Frame a string as a pkt-line. The caller includes any trailing "\n". */
export function pktLineString(text: string): Uint8Array {
  return pktLine(TEXT_ENCODER.encode(text));
}

export interface PktLine {
  /** Payload bytes, or null for a flush-pkt (0000). */
  readonly payload: Uint8Array | null;
}

/**
 * Parse a buffer of concatenated pkt-lines. `0000` yields `{ payload: null }`
 * (flush); `0001` (delim) and `0002` are treated as flush-like markers with a
 * null payload. Stops at the end of the buffer. Throws on a malformed length.
 */
export function parsePktLines(data: Uint8Array): PktLine[] {
  const lines: PktLine[] = [];
  let offset = 0;
  while (offset + 4 <= data.length) {
    const hex = TEXT_DECODER.decode(data.subarray(offset, offset + 4));
    const len = parseInt(hex, 16);
    if (Number.isNaN(len)) throw new Error(`invalid pkt-line length: ${hex}`);
    if (len === 0 || len === 1 || len === 2) {
      lines.push({ payload: null });
      offset += 4;
      continue;
    }
    if (len < 4) throw new Error(`invalid pkt-line length: ${len}`);
    const end = offset + len;
    if (end > data.length) throw new Error("truncated pkt-line");
    lines.push({ payload: data.subarray(offset + 4, end) });
    offset = end;
  }
  return lines;
}
