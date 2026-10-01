const HEX = /^[0-9a-f]{64}$/;
const MAX_HEIGHT = 16;

export type ArchiveDescriptor = {
  key: string;
  segmentIndex: number;
  firstEventId: number;
  lastEventId: number;
  count: number;
  sha256: string;
  bytes: number;
};

export type ArchiveRoot = {
  hash: string | null;
  height: number;
  entries: number;
  firstEventId: number;
  lastEventId: number;
};

function fail(reason: string): never {
  throw new Error(`Invalid run archive index: ${reason}`);
}

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("object");
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail("fields");
  return record;
}

function positive(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail("positive integer");
  return value as number;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HEX.test(value)) fail("hash");
  return value;
}

export function emptyArchiveRoot(): ArchiveRoot {
  return { hash: null, height: 0, entries: 0, firstEventId: 0, lastEventId: 0 };
}

export function parseArchiveRoot(raw: unknown): ArchiveRoot {
  const o = object(raw, ["hash", "height", "entries", "firstEventId", "lastEventId"]);
  if (o.hash === null) {
    if (o.height !== 0 || o.entries !== 0 || o.firstEventId !== 0 || o.lastEventId !== 0) fail("empty root");
    return emptyArchiveRoot();
  }
  const result = {
    hash: hash(o.hash),
    height: positive(o.height),
    entries: positive(o.entries),
    firstEventId: positive(o.firstEventId),
    lastEventId: positive(o.lastEventId),
  };
  if (result.height > MAX_HEIGHT || result.lastEventId < result.firstEventId ||
    result.entries > result.lastEventId - result.firstEventId + 1) fail("root bounds");
  return result;
}

export function parseArchiveDescriptor(raw: unknown): ArchiveDescriptor {
  const o = object(raw, ["key", "segmentIndex", "firstEventId", "lastEventId", "count", "sha256", "bytes"]);
  if (typeof o.key !== "string" || o.key.length < 1 || o.key.length > 160 ||
    Array.from(o.key).some((character) => character.charCodeAt(0) > 127)) fail("descriptor key");
  const result = {
    key: o.key,
    segmentIndex: positive(o.segmentIndex),
    firstEventId: positive(o.firstEventId),
    lastEventId: positive(o.lastEventId),
    count: positive(o.count),
    sha256: hash(o.sha256),
    bytes: positive(o.bytes),
  };
  if (result.lastEventId < result.firstEventId ||
    result.count > result.lastEventId - result.firstEventId + 1) fail("descriptor bounds");
  return result;
}
