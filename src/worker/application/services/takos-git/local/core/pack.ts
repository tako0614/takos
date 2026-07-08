/**
 * Git packfile **writer** (format v2), used to serve clone/fetch over smart
 * HTTP from the R2-backed loose-object store.
 *
 * Objects are emitted **undeltified** (full, zlib-compressed content). This is
 * a valid packfile that every git client accepts; it trades a larger transfer
 * for a simple, allocation-bounded encoder that needs no delta search. Delta
 * compression is a future optimization, not a correctness requirement.
 */

import type { ObjectStoreBinding } from "../../../../../shared/types/bindings.ts";
import type { GitObjectType } from "../git-objects.ts";
import { concatBytes, hexToBytes, sha1 } from "./sha1.ts";
import { deflate, getObject } from "./object-store.ts";
import { encodePackObjectHeader, gitTypeToNumber } from "./pack-common.ts";

const TEXT_ENCODER = new TextEncoder();

export interface PackInputObject {
  readonly type: GitObjectType;
  readonly content: Uint8Array;
}

function packHeader(objectCount: number): Uint8Array {
  const header = new Uint8Array(12);
  header.set(TEXT_ENCODER.encode("PACK"), 0);
  const view = new DataView(header.buffer);
  view.setUint32(4, 2, false); // version 2
  view.setUint32(8, objectCount, false); // object count (big-endian)
  return header;
}

/**
 * Build a packfile from fully-materialized objects. Each object is written as a
 * base (non-delta) entry; a 20-byte SHA-1 trailer over all preceding bytes is
 * appended per the pack format.
 */
export async function writePack(
  objects: readonly PackInputObject[],
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [packHeader(objects.length)];

  for (const obj of objects) {
    chunks.push(
      encodePackObjectHeader(gitTypeToNumber(obj.type), obj.content.length),
    );
    chunks.push(await deflate(obj.content));
  }

  const body = concatBytes(...chunks);
  const trailer = hexToBytes(await sha1(body));
  return concatBytes(body, trailer);
}

/**
 * Build a packfile for the given object SHAs by reading each from the object
 * store. Unknown/missing SHAs are skipped (they cannot be encoded and would
 * otherwise abort a whole clone); callers compute the SHA set from reachability
 * so a missing object signals a corrupt/partially-ingested repo, not a normal
 * case. The returned `missing` list lets the caller log/deny as appropriate.
 */
export async function writePackFromShas(
  bucket: ObjectStoreBinding,
  shas: readonly string[],
): Promise<{ pack: Uint8Array; written: number; missing: string[] }> {
  const objects: PackInputObject[] = [];
  const missing: string[] = [];

  for (const sha of shas) {
    const obj = await getObject(bucket, sha);
    if (!obj) {
      missing.push(sha);
      continue;
    }
    objects.push({ type: obj.type, content: obj.content });
  }

  const pack = await writePack(objects);
  return { pack, written: objects.length, missing };
}
