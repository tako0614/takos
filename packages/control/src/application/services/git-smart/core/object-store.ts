/**
 * Git object storage on Cloudflare R2.
 *
 * Key format: git/v2/objects/<sha1[0:2]>/<sha1[2:]>
 * Content: zlib-deflated git loose object (type size\0content)
 *
 * Uses CompressionStream/DecompressionStream (built into Workers runtime).
 */

import type { R2Bucket } from "../../../../shared/types/bindings.ts";
import type {
  GitCommit,
  GitObjectType,
  GitSignature,
  TreeEntry,
} from "../git-objects.ts";
import { isValidSha } from "../git-objects.ts";
import { concatBytes, sha1 } from "./sha1.ts";
import {
  decodeCommit,
  decodeObject,
  decodeTree,
  encodeBlob,
  encodeCommit,
  encodeCommitContent,
  encodeTree,
  encodeTreeContent,
  hashObject,
} from "./object.ts";

const OBJECT_PREFIX = "git/v2/objects";

function getObjectKey(sha: string): string {
  return `${OBJECT_PREFIX}/${sha.substring(0, 2)}/${sha.substring(2)}`;
}

function toArrayBufferView(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return bytes;
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(toArrayBufferView(data));
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

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  writer.write(toArrayBufferView(data));
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatBytes(...chunks);
}

// --- Write operations ---

export async function putBlob(
  bucket: R2Bucket,
  content: Uint8Array,
): Promise<string> {
  const sha = await hashObject("blob", content);
  const key = getObjectKey(sha);

  const existing = await bucket.head(key);
  if (existing) return sha;

  const raw = encodeBlob(content);
  const compressed = await deflate(raw);
  await bucket.put(key, compressed);

  return sha;
}

export async function putTree(
  bucket: R2Bucket,
  entries: TreeEntry[],
): Promise<string> {
  const treeContent = encodeTreeContent(entries);
  const sha = await hashObject("tree", treeContent);
  const key = getObjectKey(sha);

  const existing = await bucket.head(key);
  if (existing) return sha;

  const raw = encodeTree(entries);
  const compressed = await deflate(raw);
  await bucket.put(key, compressed);

  return sha;
}

export async function putCommit(
  bucket: R2Bucket,
  commit: {
    tree: string;
    parents: string[];
    author: GitSignature;
    committer: GitSignature;
    message: string;
  },
): Promise<string> {
  const commitContent = encodeCommitContent(commit);
  const sha = await hashObject("commit", commitContent);
  const key = getObjectKey(sha);

  const existing = await bucket.head(key);
  if (existing) return sha;

  const raw = encodeCommit(commit);
  const compressed = await deflate(raw);
  await bucket.put(key, compressed);

  return sha;
}

/**
 * Store a raw git object (already includes type+size header) by computing SHA and storing compressed.
 */
export async function putRawObject(
  bucket: R2Bucket,
  raw: Uint8Array,
): Promise<string> {
  const sha = await sha1(raw);
  const key = getObjectKey(sha);

  const existing = await bucket.head(key);
  if (existing) return sha;

  const compressed = await deflate(raw);
  await bucket.put(key, compressed);

  return sha;
}

// --- Read operations ---

export async function getRawObject(
  bucket: R2Bucket,
  sha: string,
): Promise<Uint8Array | null> {
  if (!isValidSha(sha)) return null;
  const key = getObjectKey(sha);
  const obj = await bucket.get(key);
  if (!obj) return null;
  const compressed = new Uint8Array(await obj.arrayBuffer());
  return inflate(compressed);
}

export async function getObject(
  bucket: R2Bucket,
  sha: string,
): Promise<{ type: GitObjectType; content: Uint8Array } | null> {
  const raw = await getRawObject(bucket, sha);
  if (!raw) return null;
  return decodeObject(raw);
}

export async function getBlob(
  bucket: R2Bucket,
  sha: string,
): Promise<Uint8Array | null> {
  const obj = await getObject(bucket, sha);
  if (!obj || obj.type !== "blob") return null;
  return obj.content;
}

export async function getTreeEntries(
  bucket: R2Bucket,
  sha: string,
): Promise<TreeEntry[] | null> {
  const obj = await getObject(bucket, sha);
  if (!obj || obj.type !== "tree") return null;
  return decodeTree(obj.content);
}

export async function getCommitData(
  bucket: R2Bucket,
  sha: string,
): Promise<GitCommit | null> {
  const obj = await getObject(bucket, sha);
  if (!obj || obj.type !== "commit") return null;
  const commit = decodeCommit(obj.content);
  commit.sha = sha;
  return commit;
}

export async function objectExists(
  bucket: R2Bucket,
  sha: string,
): Promise<boolean> {
  if (!isValidSha(sha)) return false;
  const key = getObjectKey(sha);
  const obj = await bucket.head(key);
  return obj !== null;
}

/**
 * Get the compressed (deflated) bytes for an object, suitable for packfile construction.
 */
export async function getCompressedObject(
  bucket: R2Bucket,
  sha: string,
): Promise<Uint8Array | null> {
  if (!isValidSha(sha)) return null;
  const key = getObjectKey(sha);
  const obj = await bucket.get(key);
  if (!obj) return null;
  return new Uint8Array(await obj.arrayBuffer());
}

export async function deleteObject(
  bucket: R2Bucket,
  sha: string,
): Promise<void> {
  if (!isValidSha(sha)) return;
  const key = getObjectKey(sha);
  await bucket.delete(key);
}

export { deflate, getObjectKey, inflate };
