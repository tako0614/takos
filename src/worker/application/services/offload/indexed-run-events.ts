import type {
  DurableNamespaceBinding,
  ObjectStoreBinding,
  ObjectStoreObjectBody,
} from "../../../shared/types/bindings.ts";
import type { PersistedRunEvent } from "./run-events.ts";
import { fetchWithTimeout } from "../execution/run-events.ts";
import {
  parseArchiveDescriptor,
  type ArchiveDescriptor,
} from "../../../shared/contracts/run-archive.ts";

const MAX_INTERNAL_PAGE_SIZE = 2001;
const MAX_DESCRIPTORS_PER_PAGE = 512;
const MAX_COMPRESSED_SEGMENT_BYTES = 8 * 1024 * 1024;
const MAX_DECOMPRESSED_SEGMENT_BYTES = 8 * 1024 * 1024;
const MAX_INDEX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_EVENT_LIMIT = 500;
const MAX_EVENT_LIMIT = 5000;
const READ_DEADLINE_MS = 5000;
export class RunArchiveReadTimeout extends Error {}

async function withReadDeadline<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new RunArchiveReadTimeout(`${label} deadline exceeded`));
      }, READ_DEADLINE_MS);
    })]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export class RunArchiveIntegrityError extends Error {}

export type RunArchiveDescriptor = ArchiveDescriptor;

type ArchivePage = {
  schemaVersion: 1;
  runId: string;
  descriptors: RunArchiveDescriptor[];
  pending: PersistedRunEvent[];
  hasMore: boolean;
};

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function descriptorKey(runId: string, segmentIndex: number): string {
  return `runs/${runId}/events/${String(segmentIndex).padStart(6, "0")}.jsonl.gz`;
}

function assertDescriptor(
  value: unknown,
  runId: string,
  after: number,
): asserts value is RunArchiveDescriptor {
  let item: ArchiveDescriptor;
  try {
    item = parseArchiveDescriptor(value);
  } catch {
    throw new RunArchiveIntegrityError("Run archive returned an invalid descriptor");
  }
  if (
    item.bytes > MAX_COMPRESSED_SEGMENT_BYTES ||
    item.firstEventId > item.lastEventId || item.lastEventId <= after ||
    item.key !== descriptorKey(runId, item.segmentIndex)
  ) {
    throw new RunArchiveIntegrityError("Run archive returned an invalid descriptor");
  }
}

function assertPersistedEvent(value: unknown): asserts value is PersistedRunEvent {
  if (!value || typeof value !== "object") {
    throw new RunArchiveIntegrityError("Run archive returned an invalid event");
  }
  const event = value as Record<string, unknown>;
  if (
    Object.keys(event).length !== 4 ||
    !["event_id", "type", "data", "created_at"].every((key) => key in event) ||
    !isPositiveSafeInteger(event.event_id) || typeof event.type !== "string" ||
    !event.type || event.type.length > 256 ||
    typeof event.data !== "string" || typeof event.created_at !== "string" ||
    !Number.isFinite(Date.parse(event.created_at))
  ) {
    throw new RunArchiveIntegrityError("Run archive returned an invalid event");
  }
}

function assertPage(
  value: unknown,
  runId: string,
  after: number,
  limit: number,
): asserts value is ArchivePage {
  if (!value || typeof value !== "object") {
    throw new RunArchiveIntegrityError("Run archive returned an invalid response");
  }
  const page = value as Record<string, unknown>;
  if (
    Object.keys(page).length !== 5 ||
    !["schemaVersion", "runId", "descriptors", "pending", "hasMore"].every((key) => key in page) ||
    page.schemaVersion !== 1 || page.runId !== runId ||
    !Array.isArray(page.descriptors) ||
    page.descriptors.length > MAX_DESCRIPTORS_PER_PAGE ||
    !Array.isArray(page.pending) || page.pending.length > limit ||
    typeof page.hasMore !== "boolean"
  ) {
    throw new RunArchiveIntegrityError("Run archive returned an invalid response");
  }

  let priorLast = 0;
  for (const descriptor of page.descriptors) {
    assertDescriptor(descriptor, runId, after);
    if (descriptor.firstEventId <= priorLast) {
      throw new RunArchiveIntegrityError("Run archive descriptors overlap or are out of order");
    }
    priorLast = descriptor.lastEventId;
  }

  let priorId = after;
  const lastArchivedId = page.descriptors.at(-1)?.lastEventId ?? after;
  for (const event of page.pending) {
    assertPersistedEvent(event);
    if (event.event_id <= priorId || event.event_id <= lastArchivedId) {
      throw new RunArchiveIntegrityError("Run archive pending events are out of order");
    }
    priorId = event.event_id;
  }
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>, maximum: number, label: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const reading = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      size += chunk.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        throw new RunArchiveIntegrityError(`${label} exceeds the size limit; offline migration repair is required`);
      }
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  })();
  try {
    return await Promise.race([reading, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        reject(new RunArchiveReadTimeout(`${label} deadline exceeded`));
        void reader.cancel().catch(() => {});
      }, READ_DEADLINE_MS);
    })]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    reader.releaseLock();
  }
}

async function readIndexResponseJson(response: Response): Promise<unknown> {
  if (!response.body) throw new RunArchiveIntegrityError("Run archive index returned an empty response");
  const bytes = await readBoundedStream(response.body, MAX_INDEX_RESPONSE_BYTES, "Run archive index response");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new RunArchiveIntegrityError("Run archive index returned invalid JSON");
  }
}

export async function readArchiveObjectBytes(object: ObjectStoreObjectBody): Promise<ArrayBuffer> {
  if (object.size > MAX_COMPRESSED_SEGMENT_BYTES) {
    throw new RunArchiveIntegrityError("Run archive segment exceeds the compressed size limit; offline migration repair is required");
  }
  if (object.body && typeof object.body.getReader === "function") {
    return copyArrayBuffer(await readBoundedStream(object.body, MAX_COMPRESSED_SEGMENT_BYTES,
      "Run archive segment compressed body"));
  }
  // Portable test/adapter objects may expose only arrayBuffer; declared size is
  // checked first and the actual bytes remain capped and deadline-bounded.
  const bytes = new Uint8Array(await withReadDeadline(object.arrayBuffer(), "Run archive body"));
  if (bytes.byteLength > MAX_COMPRESSED_SEGMENT_BYTES) {
    throw new RunArchiveIntegrityError("Run archive segment exceeds the compressed size limit; offline migration repair is required");
  }
  return copyArrayBuffer(bytes);
}

async function decompressStrict(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([copyArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream("gzip"));
  const plain = await readBoundedStream(stream, MAX_DECOMPRESSED_SEGMENT_BYTES,
    "Run archive segment decompressed body");
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", copyArrayBuffer(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function decodeRunSegment(bytes: Uint8Array): Promise<{ events: PersistedRunEvent[]; plain: string }> {
  if (bytes.byteLength > MAX_COMPRESSED_SEGMENT_BYTES) {
    throw new RunArchiveIntegrityError("Run archive segment exceeds compressed size limit; offline migration repair is required");
  }
  let jsonl: string;
  try {
    jsonl = await decompressStrict(bytes);
  } catch (error) {
    if (error instanceof RunArchiveReadTimeout) throw error;
    throw new RunArchiveIntegrityError(error instanceof Error ? error.message : String(error));
  }
  if (!jsonl.endsWith("\n")) {
    throw new RunArchiveIntegrityError("Run archive segment is not canonical JSONL");
  }
  const lines = jsonl.slice(0, -1).split("\n");
  if (lines.some((line) => line.length === 0)) {
    throw new RunArchiveIntegrityError("Run archive segment contains an empty JSONL record");
  }
  const events: PersistedRunEvent[] = [];
  let priorId = 0;
  for (const line of lines) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      throw new RunArchiveIntegrityError("Run archive segment contains malformed JSONL");
    }
    assertPersistedEvent(event);
    if (event.event_id <= priorId) {
      throw new RunArchiveIntegrityError("Run archive segment event ids are out of order");
    }
    priorId = event.event_id;
    events.push(event);
  }
  return { events, plain: jsonl };
}

/** Inspect a legacy body once; migration cannot promote unvalidated bytes. */
export async function inspectRunArchiveSegment(
  compressedBytes: ArrayBuffer, key: string, segmentIndex: number, runId: string,
): Promise<{ events: PersistedRunEvent[]; plain: string; descriptor: RunArchiveDescriptor }> {
  const bytes = new Uint8Array(compressedBytes);
  const decoded = await decodeRunSegment(bytes);
  const descriptor: RunArchiveDescriptor = {
    key, segmentIndex, firstEventId: decoded.events[0]?.event_id ?? 0,
    lastEventId: decoded.events.at(-1)?.event_id ?? 0, count: decoded.events.length,
    sha256: await sha256Hex(bytes), bytes: bytes.byteLength,
  };
  assertDescriptor(descriptor, runId, 0);
  return { ...decoded, descriptor };
}

/** Validate a canonical archived segment against its authenticated descriptor. */
export async function parseIndexedRunSegment(
  compressedBytes: ArrayBuffer | Uint8Array,
  descriptor: RunArchiveDescriptor,
  runId: string,
): Promise<PersistedRunEvent[]> {
  assertDescriptor(descriptor, runId, 0);
  const bytes = compressedBytes instanceof Uint8Array ? compressedBytes : new Uint8Array(compressedBytes);
  if (bytes.byteLength !== descriptor.bytes || bytes.byteLength > MAX_COMPRESSED_SEGMENT_BYTES) {
    throw new RunArchiveIntegrityError("Run archive segment byte length does not match its descriptor");
  }
  if (await sha256Hex(bytes) !== descriptor.sha256) {
    throw new RunArchiveIntegrityError("Run archive segment digest does not match its descriptor");
  }
  const { events } = await decodeRunSegment(bytes);
  if (events.length !== descriptor.count) {
    throw new RunArchiveIntegrityError("Run archive segment count does not match its descriptor");
  }
  if (
    events[0]?.event_id !== descriptor.firstEventId ||
    events.at(-1)?.event_id !== descriptor.lastEventId
  ) {
    throw new RunArchiveIntegrityError("Run archive segment range does not match its descriptor");
  }
  return events;
}

async function fetchArchivePage(
  namespace: DurableNamespaceBinding,
  runId: string,
  after: number,
  limit: number,
): Promise<ArchivePage> {
  const stub = namespace.get(namespace.idFromName(runId));
  const url = new URL("https://internal.do/archive");
  url.searchParams.set("runId", runId);
  url.searchParams.set("after", String(after));
  url.searchParams.set("limit", String(limit));
  const response = await fetchWithTimeout(stub, new Request(url));
  if (!response.ok) {
    throw new RunArchiveIntegrityError(`Run archive index rejected the read (${response.status})`);
  }
  const value = await readIndexResponseJson(response);
  assertPage(value, runId, after, limit);
  return value;
}

async function readDescriptor(
  bucket: ObjectStoreBinding,
  runId: string,
  descriptor: RunArchiveDescriptor,
): Promise<PersistedRunEvent[]> {
  const object = await withReadDeadline(bucket.get(descriptor.key), "Run archive GET");
  if (!object) throw new RunArchiveIntegrityError(`Run archive segment is missing: ${descriptor.key}`);
  const bytes = await readArchiveObjectBytes(object);
  return parseIndexedRunSegment(bytes, descriptor, runId);
}

/** Read a bounded Run timeline through the durable index and exact R2 keys. */
export async function getIndexedRunEventsAfter(
  namespace: DurableNamespaceBinding,
  bucket: ObjectStoreBinding,
  runId: string,
  after: number,
  limit: number = DEFAULT_EVENT_LIMIT,
): Promise<PersistedRunEvent[]> {
  if (!runId || typeof runId !== "string") throw new RunArchiveIntegrityError("Invalid run id");
  if (!isNonnegativeSafeInteger(after)) throw new RunArchiveIntegrityError("Invalid run event cursor");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_LIMIT) {
    throw new RunArchiveIntegrityError("Invalid run event limit");
  }

  const output: PersistedRunEvent[] = [];
  let cursor = after;
  while (output.length < limit) {
    const pageAfter = cursor;
    const requested = Math.min(MAX_INTERNAL_PAGE_SIZE, limit - output.length);
    const page = await fetchArchivePage(namespace, runId, cursor, requested);
    let progressed = false;
    for (const descriptor of page.descriptors) {
      const events = await readDescriptor(bucket, runId, descriptor);
      for (const event of events) {
        // Pending records from the preceding page may have been archived into
        // this segment since that snapshot. The request cursor is authoritative
        // for this page; a descriptor may legitimately straddle it.
        if (event.event_id <= pageAfter) continue;
        if (event.event_id <= cursor) {
          throw new RunArchiveIntegrityError("Run archive pages returned overlapping event ranges");
        }
        output.push(event);
        cursor = event.event_id;
        progressed = true;
        if (output.length === limit) return output;
      }
    }
    for (const event of page.pending) {
      if (event.event_id <= pageAfter) continue;
      if (event.event_id <= cursor) {
        throw new RunArchiveIntegrityError("Run archive pages returned duplicate or out-of-order events");
      }
      output.push(event);
      cursor = event.event_id;
      progressed = true;
      if (output.length === limit) return output;
    }
    if (!page.hasMore) return output;
    if (!progressed) {
      throw new RunArchiveIntegrityError("Run archive index made no progress while reporting more events");
    }
  }
  return output;
}
