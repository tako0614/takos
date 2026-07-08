/**
 * Git packfile **reader** (format v2).
 *
 * Parses a packfile received from a remote git server (external-repo import),
 * inflating each entry and resolving OFS_DELTA / REF_DELTA objects — including
 * delta-on-delta chains and thin packs whose delta bases live outside the pack
 * (resolved through `opts.resolveExternalBase`). Output is the fully
 * materialized object list with git object ids.
 *
 * This module is deliberately self-contained: it keeps its own copy of the pack
 * object-type numbers rather than importing `pack-common.ts`, so it can be read
 * and audited in isolation. Keep the numbers in sync with `pack-common.ts` if
 * the git object model ever changes.
 */

import type { GitObjectType } from "../git-objects.ts";
import { hashObject } from "./object.ts";
import { inflateZlibAt } from "./inflate-raw.ts";

// Packfile object type numbers (git pack format v2).
const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;

const BASE_TYPE_BY_NUMBER: Record<number, GitObjectType> = {
  [OBJ_COMMIT]: "commit",
  [OBJ_TREE]: "tree",
  [OBJ_BLOB]: "blob",
  [OBJ_TAG]: "tag",
};

const ALL_TYPES: readonly GitObjectType[] = ["blob", "tree", "commit", "tag"];

const TEXT_DECODER = new TextDecoder();

export interface UnpackedObject {
  readonly type: GitObjectType;
  readonly content: Uint8Array;
  readonly sha: string;
}

export interface ReadPackOptions {
  /**
   * Resolve a delta base that is not present in this pack (thin pack). Returns
   * the base object's **content** bytes (no `"<type> <size>\0"` header), or
   * `null` if the base cannot be provided. The base type is recovered by
   * matching the requested sha against the four git object-id encodings.
   */
  resolveExternalBase?: (sha: string) => Promise<Uint8Array | null>;
}

/** A raw entry as parsed in the first pass, before delta resolution. */
interface PackEntry {
  readonly start: number;
  readonly typeNum: number;
  /** Inflated payload: object content for base objects, delta stream for deltas. */
  readonly payload: Uint8Array;
  /** For OFS_DELTA: absolute pack offset of the base object. */
  readonly baseOffset: number;
  /** For REF_DELTA: 40-char hex sha of the base object. */
  readonly baseSha: string;
}

interface ResolvedObject {
  readonly type: GitObjectType;
  readonly content: Uint8Array;
}

function bytesToHexLocal(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Read the packfile object header at `offset`: a 3-bit type plus a base-128
 * size varint whose first byte carries the low 4 size bits. Size uses
 * multiplication (not `<<`) so it stays exact past 2^31 for large objects.
 */
function readObjectHeader(
  pack: Uint8Array,
  offset: number,
): { typeNum: number; size: number; next: number } {
  if (offset >= pack.length) {
    throw new Error("pack: truncated object header");
  }
  let byte = pack[offset++];
  const typeNum = (byte >> 4) & 0x07;
  let size = byte & 0x0f;
  let shift = 4;
  while (byte & 0x80) {
    if (offset >= pack.length) throw new Error("pack: truncated object header");
    byte = pack[offset++];
    size += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  }
  return { typeNum, size, next: offset };
}

/**
 * Read a git OFS_DELTA negative base offset: big-endian base-128 with the +1
 * continuation convention. Returns the positive distance to subtract from the
 * delta object's start offset.
 */
function readOffsetVarint(
  pack: Uint8Array,
  offset: number,
): { value: number; next: number } {
  if (offset >= pack.length) throw new Error("pack: truncated ofs-delta offset");
  let byte = pack[offset++];
  let value = byte & 0x7f;
  while (byte & 0x80) {
    if (offset >= pack.length) {
      throw new Error("pack: truncated ofs-delta offset");
    }
    value += 1;
    byte = pack[offset++];
    value = value * 128 + (byte & 0x7f);
  }
  return { value, next: offset };
}

/** Read a delta size varint (little-endian base-128). */
function readDeltaSize(
  delta: Uint8Array,
  offset: number,
): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let byte: number;
  do {
    if (offset >= delta.length) throw new Error("delta: truncated size varint");
    byte = delta[offset++];
    value += (byte & 0x7f) * 2 ** shift;
    shift += 7;
  } while (byte & 0x80);
  return { value, next: offset };
}

/**
 * Apply a git delta (`delta`) against `base`, returning the reconstructed
 * target. Copy ops (high bit set) reference ranges of `base`; insert ops (high
 * bit clear) carry 1..127 literal bytes.
 */
export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  const srcRead = readDeltaSize(delta, 0);
  if (srcRead.value !== base.length) {
    throw new Error("delta: source size mismatch");
  }
  const tgtRead = readDeltaSize(delta, srcRead.next);
  const targetSize = tgtRead.value;
  const out = new Uint8Array(targetSize);

  let p = tgtRead.next;
  let outPos = 0;
  while (p < delta.length) {
    const op = delta[p++];
    if (op & 0x80) {
      // Copy from base: offset/size assembled from the flagged following bytes.
      let copyOffset = 0;
      let copySize = 0;
      if (op & 0x01) copyOffset = delta[p++];
      if (op & 0x02) copyOffset += (delta[p++] ?? 0) << 8;
      if (op & 0x04) copyOffset += (delta[p++] ?? 0) << 16;
      if (op & 0x08) copyOffset += (delta[p++] ?? 0) * 0x1000000;
      if (op & 0x10) copySize = delta[p++];
      if (op & 0x20) copySize += (delta[p++] ?? 0) << 8;
      if (op & 0x40) copySize += (delta[p++] ?? 0) << 16;
      if (copySize === 0) copySize = 0x10000;
      if (p > delta.length) throw new Error("delta: truncated copy op");
      if (copyOffset + copySize > base.length) {
        throw new Error("delta: copy out of base bounds");
      }
      if (outPos + copySize > targetSize) {
        throw new Error("delta: copy overflows target");
      }
      out.set(base.subarray(copyOffset, copyOffset + copySize), outPos);
      outPos += copySize;
    } else if (op !== 0) {
      // Insert `op` literal bytes.
      if (p + op > delta.length) throw new Error("delta: truncated insert op");
      if (outPos + op > targetSize) {
        throw new Error("delta: insert overflows target");
      }
      out.set(delta.subarray(p, p + op), outPos);
      p += op;
      outPos += op;
    } else {
      throw new Error("delta: opcode 0x00 is reserved");
    }
  }

  if (outPos !== targetSize) {
    throw new Error("delta: reconstructed size mismatch");
  }
  return out;
}

function validateHeader(pack: Uint8Array): number {
  if (pack.length < 12) throw new Error("pack: shorter than 12-byte header");
  if (
    pack[0] !== 0x50 || // 'P'
    pack[1] !== 0x41 || // 'A'
    pack[2] !== 0x43 || // 'C'
    pack[3] !== 0x4b // 'K'
  ) {
    throw new Error("pack: bad magic (expected 'PACK')");
  }
  const view = new DataView(pack.buffer, pack.byteOffset, pack.byteLength);
  const version = view.getUint32(4, false);
  if (version !== 2) {
    throw new Error(`pack: unsupported version ${version} (expected 2)`);
  }
  return view.getUint32(8, false);
}

/**
 * Determine the git object type of an external base by matching its content
 * against the requested sha under each of the four object-id encodings.
 */
async function typeOfExternalBase(
  content: Uint8Array,
  sha: string,
): Promise<GitObjectType> {
  for (const type of ALL_TYPES) {
    if ((await hashObject(type, content)) === sha) return type;
  }
  throw new Error(`pack: external base content does not match sha ${sha}`);
}

/**
 * Parse and fully resolve a git packfile (v2). Returns each contained object
 * exactly once, in resolution order. Delta objects (OFS_DELTA / REF_DELTA) are
 * reconstructed against their bases, chaining as needed; thin-pack bases are
 * fetched via `opts.resolveExternalBase`.
 */
export async function readPack(
  pack: Uint8Array,
  opts?: ReadPackOptions,
): Promise<UnpackedObject[]> {
  const count = validateHeader(pack);

  // --- First pass: parse every entry (inflate payloads, capture delta bases). ---
  const entries: PackEntry[] = [];
  const byOffset = new Map<number, number>(); // pack offset -> entry index
  let cursor = 12;

  for (let i = 0; i < count; i++) {
    const start = cursor;
    const { typeNum, size, next } = readObjectHeader(pack, cursor);
    cursor = next;

    let baseOffset = -1;
    let baseSha = "";

    if (typeNum === OBJ_OFS_DELTA) {
      const off = readOffsetVarint(pack, cursor);
      cursor = off.next;
      baseOffset = start - off.value;
      if (baseOffset < 12 || baseOffset >= start) {
        throw new Error("pack: ofs-delta base offset out of range");
      }
    } else if (typeNum === OBJ_REF_DELTA) {
      if (cursor + 20 > pack.length) {
        throw new Error("pack: truncated ref-delta base id");
      }
      baseSha = bytesToHexLocal(pack.subarray(cursor, cursor + 20));
      cursor += 20;
    } else if (BASE_TYPE_BY_NUMBER[typeNum] === undefined) {
      throw new Error(`pack: unknown object type ${typeNum}`);
    }

    const { output, bytesConsumed } = inflateZlibAt(pack, cursor);
    if (output.length !== size) {
      throw new Error(
        `pack: inflated size ${output.length} != header size ${size}`,
      );
    }
    cursor += bytesConsumed;

    byOffset.set(start, entries.length);
    entries.push({ start, typeNum, payload: output, baseOffset, baseSha });
  }

  // A 20-byte SHA-1 trailer follows the last object.
  if (cursor + 20 > pack.length) {
    throw new Error("pack: truncated trailer");
  }

  // --- Second pass: resolve deltas (memoized, in file order). ---
  const resolved = new Array<ResolvedObject | undefined>(entries.length);
  const resolving = new Uint8Array(entries.length); // cycle guard
  const shaToIndex = new Map<string, number>(); // sha -> resolved entry index
  const externalCache = new Map<string, ResolvedObject>();

  // Pre-index base (non-delta) shas so in-pack REF_DELTA bases resolve directly.
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const baseType = BASE_TYPE_BY_NUMBER[e.typeNum];
    if (baseType !== undefined) {
      const sha = await hashObject(baseType, e.payload);
      if (!shaToIndex.has(sha)) shaToIndex.set(sha, i);
    }
  }

  async function resolveExternal(sha: string): Promise<ResolvedObject> {
    const cached = externalCache.get(sha);
    if (cached) return cached;
    const fetchBase = opts?.resolveExternalBase;
    if (!fetchBase) {
      throw new Error(`pack: ref-delta base ${sha} not in pack (no resolver)`);
    }
    const content = await fetchBase(sha);
    if (!content) {
      throw new Error(`pack: ref-delta base ${sha} could not be resolved`);
    }
    const type = await typeOfExternalBase(content, sha);
    const obj: ResolvedObject = { type, content };
    externalCache.set(sha, obj);
    return obj;
  }

  async function resolveEntry(index: number): Promise<ResolvedObject> {
    const existing = resolved[index];
    if (existing) return existing;
    if (resolving[index]) {
      throw new Error("pack: delta base cycle detected");
    }
    resolving[index] = 1;

    const e = entries[index];
    let result: ResolvedObject;

    const baseType = BASE_TYPE_BY_NUMBER[e.typeNum];
    if (baseType !== undefined) {
      result = { type: baseType, content: e.payload };
    } else if (e.typeNum === OBJ_OFS_DELTA) {
      const baseIndex = byOffset.get(e.baseOffset);
      if (baseIndex === undefined) {
        throw new Error("pack: ofs-delta base offset not found");
      }
      const base = await resolveEntry(baseIndex);
      result = {
        type: base.type,
        content: applyDelta(base.content, e.payload),
      };
    } else {
      // REF_DELTA
      const baseIndex = shaToIndex.get(e.baseSha);
      const base =
        baseIndex !== undefined && baseIndex !== index
          ? await resolveEntry(baseIndex)
          : await resolveExternal(e.baseSha);
      result = {
        type: base.type,
        content: applyDelta(base.content, e.payload),
      };
    }

    resolving[index] = 0;
    resolved[index] = result;
    // Make this object available as a base for later in-pack ref-deltas.
    const sha = await hashObject(result.type, result.content);
    if (!shaToIndex.has(sha)) shaToIndex.set(sha, index);
    return result;
  }

  const objects: UnpackedObject[] = [];
  for (let i = 0; i < entries.length; i++) {
    const obj = await resolveEntry(i);
    const sha = await hashObject(obj.type, obj.content);
    objects.push({ type: obj.type, content: obj.content, sha });
  }
  return objects;
}

/** Decode a raw git object's `"<type> <size>\0"` header (test/debug helper). */
export function peekObjectType(raw: Uint8Array): string {
  const space = raw.indexOf(0x20);
  const nul = raw.indexOf(0x00);
  if (space === -1 || nul === -1 || space > nul) {
    throw new Error("object: malformed header");
  }
  return TEXT_DECODER.decode(raw.subarray(0, space));
}
