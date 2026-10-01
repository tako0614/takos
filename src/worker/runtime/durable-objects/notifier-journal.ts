import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import { logWarn } from "../../shared/utils/logger.ts";
import { parseNotificationNotifierState, parseRunNotifierState } from "./notifier-state.ts";

export const MAX_NOTIFIER_SNAPSHOT_BYTES = 8 * 1024 * 1024;
export const NOTIFIER_CHUNK_BYTES = 64 * 1024;
const MAX_CHUNKS = 128;
const CHUNK_PREFIX = "notifier-v2/chunks/";
const HEAD_KEY = "bufferState";
const DIGEST = /^[a-f0-9]{64}$/;
type Kind = "run" | "notification";

export interface NotifierBlobRef {
  bytes: number;
  digest: string;
  chunks: string[];
}

type Head = {
  schemaVersion: 2;
  kind: Kind;
  commitId: string;
  snapshot: NotifierBlobRef;
  blobs: NotifierBlobRef[];
};

export class NotifierCapacityError extends Error {
  constructor() {
    super("Notifier journal capacity exhausted; pending data is retained");
    this.name = "NotifierCapacityError";
  }
}

function invalid(field: string): never {
  throw new Error(`Invalid persisted notifier journal: ${field}`);
}

function record(raw: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid(field);
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))) invalid(field);
  return value;
}

function parseRef(raw: unknown): NotifierBlobRef {
  const value = record(raw, ["bytes", "digest", "chunks"], "blob.fields");
  if (typeof value.bytes !== "number" || !Number.isSafeInteger(value.bytes) ||
    value.bytes < 0 || value.bytes > MAX_NOTIFIER_SNAPSHOT_BYTES) invalid("blob.bytes");
  if (typeof value.digest !== "string" || !DIGEST.test(value.digest)) invalid("blob.digest");
  if (!Array.isArray(value.chunks) ||
    value.chunks.length !== Math.ceil(value.bytes / NOTIFIER_CHUNK_BYTES) ||
    value.chunks.length > MAX_CHUNKS ||
    value.chunks.some((chunk) => typeof chunk !== "string" || !DIGEST.test(chunk))) {
    invalid("blob.chunks");
  }
  return { bytes: value.bytes, digest: value.digest, chunks: value.chunks.slice() };
}

function checkBudget(refs: NotifierBlobRef[], reserveBytes = 0): void {
  if (!Number.isSafeInteger(reserveBytes) || reserveBytes < 0) throw new NotifierCapacityError();
  const bytes = refs.reduce((total, ref) => total + ref.bytes, reserveBytes);
  const chunks = refs.reduce((total, ref) => total + ref.chunks.length, 0);
  if (bytes > MAX_NOTIFIER_SNAPSHOT_BYTES || chunks > MAX_CHUNKS) {
    throw new NotifierCapacityError();
  }
}

function parseHead(raw: unknown, kind: Kind): Head {
  const value = record(raw, ["schemaVersion", "kind", "commitId", "snapshot", "blobs"], "head.fields");
  if (value.schemaVersion !== 2 || value.kind !== kind) invalid("head.versionOrKind");
  if (typeof value.commitId !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.commitId)) invalid("head.commitId");
  if (!Array.isArray(value.blobs) || value.blobs.length > MAX_CHUNKS) invalid("head.blobs");
  const snapshot = parseRef(value.snapshot);
  if (snapshot.bytes === 0) invalid("head.snapshot");
  const blobs = value.blobs.map(parseRef);
  try {
    checkBudget([snapshot, ...blobs]);
  } catch {
    invalid("head.budget");
  }
  return { schemaVersion: 2, kind, commitId: value.commitId, snapshot, blobs };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function fromBase64(raw: unknown): Uint8Array {
  if (typeof raw !== "string" || raw.length > Math.ceil(NOTIFIER_CHUNK_BYTES / 3) * 4 ||
    raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) invalid("chunk.encoding");
  let binary: string;
  try {
    binary = atob(raw);
  } catch {
    invalid("chunk.encoding");
  }
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function serialize(snapshot: unknown): Uint8Array {
  const json = JSON.stringify(snapshot);
  if (json === undefined) invalid("snapshot.encoding");
  return new TextEncoder().encode(json);
}

/** Stable JSON payload witness; ordering does not depend on an isolate's locale. */
export async function digestNotifierPayload(value: unknown): Promise<string> {
  function canonical(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, child]) => [key, canonical(child)]));
    }
    return item;
  }
  return sha256(serialize(canonical(value)));
}

export function assertNotifierSnapshotBudget(
  snapshot: unknown,
  blobs: NotifierBlobRef[] = [],
  reserveBytes = 0,
): void {
  const bytes = serialize(snapshot).length;
  const descriptor: NotifierBlobRef = {
    bytes,
    digest: "",
    chunks: Array.from({ length: Math.ceil(bytes / NOTIFIER_CHUNK_BYTES) }, () => ""),
  };
  checkBudget([descriptor, ...blobs.map(parseRef)], reserveBytes);
}

/** Immutable values stay well below the legacy KV serialized-value limit. */
export async function stageNotifierBlob(
  storage: DurableObjectStorageBinding,
  data: ArrayBuffer | Uint8Array,
): Promise<NotifierBlobRef> {
  const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer);
  if (bytes.length > MAX_NOTIFIER_SNAPSHOT_BYTES) throw new NotifierCapacityError();
  // A crash before publishing the head can leave staging copies. Cleanup must
  // still run when no later event arrives, including installations with no WS.
  await armCleanup(storage);
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += NOTIFIER_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + NOTIFIER_CHUNK_BYTES);
    const digest = await sha256(chunk);
    const key = CHUNK_PREFIX + digest;
    const existing = await storage.get<unknown>(key);
    if (existing === undefined) {
      await storage.put(key, toBase64(chunk));
    } else if (await sha256(fromBase64(existing)) !== digest) {
      invalid("chunk.collision");
    }
    // A staged chunk is not a commit. Verify bytes before publishing a head.
    const written = fromBase64(await storage.get<unknown>(key));
    if (written.length !== chunk.length || await sha256(written) !== digest) {
      invalid("chunk.writeReadback");
    }
    chunks.push(digest);
  }
  return { bytes: bytes.length, digest: await sha256(bytes), chunks };
}

export async function readNotifierBlob(
  storage: DurableObjectStorageBinding,
  raw: NotifierBlobRef,
): Promise<ArrayBuffer> {
  const ref = parseRef(raw);
  const bytes = new Uint8Array(ref.bytes);
  for (let index = 0; index < ref.chunks.length; index++) {
    const digest = ref.chunks[index]!;
    const chunk = fromBase64(await storage.get<unknown>(CHUNK_PREFIX + digest));
    const expected = Math.min(NOTIFIER_CHUNK_BYTES, ref.bytes - index * NOTIFIER_CHUNK_BYTES);
    if (chunk.length !== expected || await sha256(chunk) !== digest) invalid("chunk.integrity");
    bytes.set(chunk, index * NOTIFIER_CHUNK_BYTES);
  }
  if (await sha256(bytes) !== ref.digest) invalid("blob.integrity");
  return bytes.buffer;
}

export async function loadNotifierSnapshot(
  storage: DurableObjectStorageBinding,
  kind: Kind,
): Promise<unknown> {
  const raw = await storage.get<unknown>(HEAD_KEY);
  if (!raw || typeof raw !== "object" ||
    (raw as Record<string, unknown>).schemaVersion !== 2) return raw;
  const head = parseHead(raw, kind);
  const bytes = await readNotifierBlob(storage, head.snapshot);
  for (const blob of head.blobs) await readNotifierBlob(storage, blob);
  let snapshot: unknown;
  try {
    snapshot = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    invalid("snapshot.encoding");
  }
  // The logical state must declare exactly the live blobs protected by the head.
  // Notification snapshots have no auxiliary blobs; run snapshots name intents.
  validateBlobClosure(snapshot, head.blobs);
  return snapshot;
}

function validateBlobClosure(snapshot: unknown, blobs: NotifierBlobRef[]): void {
  const intents = snapshot && typeof snapshot === "object"
    ? (snapshot as Record<string, unknown>).flushIntents
    : undefined;
  const declared = Array.isArray(intents)
    ? intents.map((intent) => intent && typeof intent === "object"
      ? (intent as Record<string, unknown>).blob : undefined)
    : [];
  if (JSON.stringify(declared.map(parseRef)) !== JSON.stringify(blobs)) invalid("head.blobClosure");
}

/** Caller holds notifier serialization. Only unreachable internal copies are removed. */
async function armCleanup(storage: DurableObjectStorageBinding): Promise<void> {
  const now = Date.now();
  const when = now + 30_000;
  const current = await storage.getAlarm();
  if (current === null || current <= now || current > when) await storage.setAlarm(when);
}

async function collectGarbage(storage: DurableObjectStorageBinding, head: Head | null): Promise<void> {
  // Some test-only bindings implement neither list nor delete; real bindings do.
  if (typeof storage.list !== "function" || typeof storage.delete !== "function") return;
  const raw = await storage.get<unknown>(HEAD_KEY);
  const current = head ? parseHead(raw, head.kind) : null;
  if (current && current.commitId !== head?.commitId) return;
  if (!head && raw && typeof raw === "object" &&
    (raw as Record<string, unknown>).schemaVersion === 2) invalid("cleanup.headChanged");
  // A committed head alone does not justify deleting repair copies. Validate
  // all live bytes and closure immediately before any cleanup path deletes.
  if (current) await loadNotifierSnapshot(storage, current.kind);
  const live = new Set(current ? [current.snapshot, ...current.blobs].flatMap((ref) =>
    ref.chunks.map((digest) => CHUNK_PREFIX + digest)) : []);
  // At most 128 live chunks; a 256-key scan always makes room for crash-left
  // staging orphans without depending on adapter-specific pagination options.
  const values = await storage.list({ prefix: CHUNK_PREFIX, limit: 256 });
  // Schedule before deletion. A failed batch or a bounded scan must not leave
  // the remaining copies dependent on another user request.
  if (values.size > live.size) await armCleanup(storage);
  const garbage = Array.from(values.keys()).filter((key) =>
    key.startsWith(CHUNK_PREFIX) && DIGEST.test(key.slice(CHUNK_PREFIX.length)) && !live.has(key));
  for (let offset = 0; offset < garbage.length; offset += 128) {
    await storage.delete(garbage.slice(offset, offset + 128));
  }
}

/** Called only after domain initialization and while holding notifier serialization. */
export async function collectNotifierGarbage(
  storage: DurableObjectStorageBinding,
  kind: Kind,
): Promise<void> {
  const raw = await storage.get<unknown>(HEAD_KEY);
  const head = raw && typeof raw === "object" &&
    (raw as Record<string, unknown>).schemaVersion === 2 ? parseHead(raw, kind) : null;
  if (!head && kind === "run") {
    parseRunNotifierState(raw);
  } else if (!head) {
    parseNotificationNotifierState(raw);
  }
  await collectGarbage(storage, head);
}

export async function persistNotifierSnapshot(
  storage: DurableObjectStorageBinding,
  kind: Kind,
  snapshot: unknown,
  blobs: NotifierBlobRef[] = [],
): Promise<void> {
  assertNotifierSnapshotBudget(snapshot, blobs);
  const checkedBlobs = blobs.map(parseRef);
  validateBlobClosure(snapshot, checkedBlobs);
  const ref = await stageNotifierBlob(storage, serialize(snapshot));
  for (const blob of checkedBlobs) await readNotifierBlob(storage, blob);
  const head: Head = {
    schemaVersion: 2, kind, commitId: crypto.randomUUID(), snapshot: ref, blobs: checkedBlobs,
  };
  // This is the sole commit point. A rejected put is ambiguous; the caller must
  // reload before accepting another operation, even if the preceding chunks fit.
  await storage.put(HEAD_KEY, head);
  const committed = parseHead(await storage.get<unknown>(HEAD_KEY), kind);
  if (committed.commitId !== head.commitId) invalid("head.writeReadback");
  await loadNotifierSnapshot(storage, kind);
  try {
    await collectGarbage(storage, head);
  } catch (error) {
    // Cleanup failure cannot revoke a successfully committed event.
    logWarn("Notifier internal chunk cleanup deferred", {
      module: "notifier-journal", detail: error instanceof Error ? error.message : String(error),
    });
  }
}
