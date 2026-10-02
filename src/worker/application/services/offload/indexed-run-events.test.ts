import { expect, test } from "bun:test";
import type {
  DurableNamespaceBinding,
  ObjectStoreBinding,
} from "../../../shared/types/bindings.ts";
import { gzipCompressString } from "../../../shared/utils/gzip.ts";
import {
  getIndexedRunEventsAfter,
  inspectRunArchiveSegment,
  parseIndexedRunSegment,
  readArchiveObjectBytes,
  type RunArchiveDescriptor,
} from "./indexed-run-events.ts";

type Event = {
  event_id: number;
  type: string;
  data: string;
  created_at: string;
};

const runId = "run-indexed";
const timestamp = "2026-09-30T12:00:00.000Z";

function event(event_id: number): Event {
  return {
    event_id,
    type: "progress",
    data: JSON.stringify({ n: event_id }),
    created_at: timestamp,
  };
}

async function archiveSegment(
  index: number,
  events: Event[],
): Promise<{ descriptor: RunArchiveDescriptor; bytes: Uint8Array }> {
  const plain = events.map((item) => JSON.stringify(item)).join("\n") + "\n";
  const bytes = new Uint8Array(await gzipCompressString(plain));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const descriptor = {
    key: `runs/${runId}/events/${String(index).padStart(6, "0")}.jsonl.gz`,
    segmentIndex: index,
    firstEventId: events[0]!.event_id,
    lastEventId: events.at(-1)!.event_id,
    count: events.length,
    sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
    bytes: bytes.byteLength,
  };
  return { descriptor, bytes };
}

function indexedNamespace(
  read: (url: URL) => unknown | Promise<unknown>,
): DurableNamespaceBinding {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        return Response.json(await read(url));
      },
    }),
  } as unknown as DurableNamespaceBinding;
}

function bucketFor(
  objects: Map<string, Uint8Array>,
  reads: string[] = [],
  missing = new Set<string>(),
): ObjectStoreBinding {
  return {
    list: async () => {
      throw new Error("indexed history must never list R2");
    },
    get: async (key: string) => {
      reads.push(key);
      const bytes = objects.get(key);
      if (!bytes || missing.has(key)) return null;
      const bodyBytes = bytes.slice();
      return {
        key,
        size: bytes.byteLength,
        body: new Blob([bodyBytes]).stream(),
        arrayBuffer: async () => bodyBytes.slice().buffer,
      } as never;
    },
  } as unknown as ObjectStoreBinding;
}

function page(
  descriptors: RunArchiveDescriptor[],
  options: { pending?: Event[]; hasMore?: boolean } = {},
) {
  return {
    schemaVersion: 1,
    runId,
    descriptors,
    pending: options.pending ?? [],
    hasMore: options.hasMore ?? false,
  };
}

test("indexed history reads only needed exact segments for a deep sparse tail", async () => {
  const a = await archiveSegment(1_000_001, [event(3), event(9)]);
  const b = await archiveSegment(8_000_001, [event(14), event(22)]);
  const objects = new Map([
    [a.descriptor.key, a.bytes],
    [b.descriptor.key, b.bytes],
  ]);
  const reads: string[] = [];
  let indexReads = 0;
  const namespace = indexedNamespace((url) => {
    indexReads += 1;
    expect(url.pathname).toBe("/archive");
    expect(url.searchParams.get("runId")).toBe(runId);
    return page([a.descriptor, b.descriptor]);
  });

  const actual = await getIndexedRunEventsAfter(
    namespace,
    bucketFor(objects, reads),
    runId,
    8,
    1,
  );

  expect(actual.map((item) => item.event_id)).toEqual([9]);
  expect(reads).toEqual([a.descriptor.key]);
  expect(indexReads).toBe(1);
});

test("indexed history advances through more than 512 descriptors without R2 listing", async () => {
  const segments = await Promise.all(
    Array.from({ length: 514 }, (_, offset) =>
      archiveSegment(offset + 1, [event(offset + 1)])
    ),
  );
  const objects = new Map(segments.map(({ descriptor, bytes }) => [descriptor.key, bytes]));
  const reads: string[] = [];
  let pageCount = 0;
  const namespace = indexedNamespace((url) => {
    pageCount += 1;
    const after = Number(url.searchParams.get("after"));
    const selected = segments.filter(({ descriptor }) => descriptor.lastEventId > after)
      .slice(0, 512).map(({ descriptor }) => descriptor);
    const hasMore = segments.some(({ descriptor }) =>
      descriptor.lastEventId > (selected.at(-1)?.lastEventId ?? after)
    );
    return page(selected, { hasMore });
  });

  const actual = await getIndexedRunEventsAfter(
    namespace,
    bucketFor(objects, reads),
    runId,
    0,
    514,
  );

  expect(actual).toHaveLength(514);
  expect(actual[513]?.event_id).toBe(514);
  expect(pageCount).toBe(2);
  expect(reads).toHaveLength(514);
});

test("indexed history merges indexed pending events older than a notifier ring and accepts jumps", async () => {
  const archived = await archiveSegment(2, [event(5), event(11)]);
  const objects = new Map([[archived.descriptor.key, archived.bytes]]);
  const namespace = indexedNamespace(() =>
    page([archived.descriptor], { pending: [event(28)] })
  );
  const events = await getIndexedRunEventsAfter(
    namespace,
    bucketFor(objects),
    runId,
    4,
    3,
  );
  expect(events.map((item) => item.event_id)).toEqual([5, 11, 28]);
});

test("indexed history allows the cursor to land inside an archived segment", async () => {
  const archive = await archiveSegment(1, [event(1), event(100)]);
  const namespace = indexedNamespace(() => page([archive.descriptor]));
  const events = await getIndexedRunEventsAfter(
    namespace,
    bucketFor(new Map([[archive.descriptor.key, archive.bytes]])),
    runId,
    50,
    1,
  );
  expect(events.map((item) => item.event_id)).toEqual([100]);
});

test("an archive published after the index snapshot cannot change its exact R2 read", async () => {
  const snapshot = await archiveSegment(1, [event(4)]);
  const concurrentlyPublished = await archiveSegment(2, [event(9)]);
  const currentCatalog = [snapshot.descriptor];
  const reads: string[] = [];
  const namespace = indexedNamespace(() => {
    const response = page([...currentCatalog]);
    currentCatalog.push(concurrentlyPublished.descriptor);
    return response;
  });

  const actual = await getIndexedRunEventsAfter(
    namespace,
    bucketFor(new Map([
      [snapshot.descriptor.key, snapshot.bytes],
      [concurrentlyPublished.descriptor.key, concurrentlyPublished.bytes],
    ]), reads),
    runId,
    0,
    1,
  );

  expect(actual.map((item) => item.event_id)).toEqual([4]);
  expect(reads).toEqual([snapshot.descriptor.key]);
});

test("pending archived between pages may straddle the new request cursor", async () => {
  const archive = await archiveSegment(1, [event(1), event(2), event(3)]);
  const cursors: number[] = [];
  const namespace = indexedNamespace((url) => {
    const after = Number(url.searchParams.get("after"));
    cursors.push(after);
    return after === 0 ? page([], { pending: [event(1), event(2)], hasMore: true })
      : page([archive.descriptor]);
  });
  const actual = await getIndexedRunEventsAfter(namespace,
    bucketFor(new Map([[archive.descriptor.key, archive.bytes]])), runId, 0, 3);
  expect(actual.map((item) => item.event_id)).toEqual([1, 2, 3]);
  expect(cursors).toEqual([0, 2]);
});

test("indexed history rejects malformed index, missing objects, digest, and segment range errors", async () => {
  const archive = await archiveSegment(1, [event(1), event(4)]);
  const validNamespace = indexedNamespace(() => page([archive.descriptor]));

  await expect(getIndexedRunEventsAfter(
    indexedNamespace(() => ({ ...page([]), runId: "another-run" })),
    bucketFor(new Map()),
    runId,
    0,
  )).rejects.toThrow("invalid response");
  await expect(getIndexedRunEventsAfter(
    validNamespace,
    bucketFor(new Map()),
    runId,
    0,
  )).rejects.toThrow("missing");

  await expect(getIndexedRunEventsAfter(
    indexedNamespace(() => page([{ ...archive.descriptor, bytes: archive.descriptor.bytes + 1 }])),
    bucketFor(new Map([[archive.descriptor.key, archive.bytes]])),
    runId,
    0,
  )).rejects.toThrow("byte length");

  const corrupt = archive.bytes.slice();
  corrupt[corrupt.length - 1] ^= 1;
  await expect(getIndexedRunEventsAfter(
    validNamespace,
    bucketFor(new Map([[archive.descriptor.key, corrupt]])),
    runId,
    0,
  )).rejects.toThrow();

  const wrongRange = { ...archive.descriptor, lastEventId: 5 };
  const wrongRangeBytes = new Map([[wrongRange.key, archive.bytes]]);
  await expect(getIndexedRunEventsAfter(
    indexedNamespace(() => page([wrongRange])),
    bucketFor(wrongRangeBytes),
    runId,
    0,
  )).rejects.toThrow("range");
});

test("indexed history rejects conflicting duplicates and hasMore without progress", async () => {
  const archive = await archiveSegment(1, [event(1)]);
  const namespace = indexedNamespace((url) => {
    if (url.searchParams.get("after") === "0") {
      return page([archive.descriptor], { hasMore: true });
    }
    return page([], { pending: [event(1)], hasMore: true });
  });
  await expect(getIndexedRunEventsAfter(
    namespace,
    bucketFor(new Map([[archive.descriptor.key, archive.bytes]])),
    runId,
    0,
    10,
  )).rejects.toThrow("out of order");

  await expect(getIndexedRunEventsAfter(
    indexedNamespace(() => page([], { hasMore: true })),
    bucketFor(new Map()),
    runId,
    0,
  )).rejects.toThrow("no progress");
});

test("migration parser verifies the same exact segment contract", async () => {
  const archive = await archiveSegment(7, [event(9), event(17)]);
  expect((await parseIndexedRunSegment(archive.bytes, archive.descriptor, runId))
    .map((item) => item.event_id)).toEqual([9, 17]);
  await expect(parseIndexedRunSegment(
    archive.bytes,
    { ...archive.descriptor, count: 3 },
    runId,
  )).rejects.toThrow("count");
});

test("legacy inspection classifies noncanonical and oversized bodies as integrity repair", async () => {
  const noncanonical = await gzipCompressString(JSON.stringify(event(1)));
  await expect(inspectRunArchiveSegment(noncanonical,
    `runs/${runId}/events/000001.jsonl.gz`, 1, runId)).rejects.toThrow("canonical JSONL");
  const oversized = await gzipCompressString(JSON.stringify({ ...event(1),
    data: "x".repeat(8 * 1024 * 1024) }) + "\n");
  await expect(inspectRunArchiveSegment(oversized,
    `runs/${runId}/events/000001.jsonl.gz`, 1, runId)).rejects.toThrow("offline migration repair");
  let bodyReads = 0;
  await expect(readArchiveObjectBytes({ size: 8 * 1024 * 1024 + 1,
    arrayBuffer: async () => { bodyReads++; return new ArrayBuffer(0); } } as never))
    .rejects.toThrow("compressed size limit");
  expect(bodyReads).toBe(0);
});

test("a stalled archive stream is cancelled at its production read deadline", async () => {
  let cancelled = false;
  const object = { size: 1, body: new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
  }) };
  await expect(readArchiveObjectBytes(object as never)).rejects.toThrow("deadline exceeded");
  expect(cancelled).toBe(true);
}, 7000);

test("indexed history rejects DO failures and malformed JSON responses", async () => {
  const failingNamespace = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => new Response("unavailable", { status: 503 }) }),
  } as unknown as DurableNamespaceBinding;
  await expect(getIndexedRunEventsAfter(
    failingNamespace,
    bucketFor(new Map()),
    runId,
    0,
  )).rejects.toThrow("503");

  const malformedNamespace = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async () => new Response("{" ) }),
  } as unknown as DurableNamespaceBinding;
  await expect(getIndexedRunEventsAfter(
    malformedNamespace,
    bucketFor(new Map()),
    runId,
    0,
  )).rejects.toThrow("invalid JSON");
});
