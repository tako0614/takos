import { test } from "bun:test";
import assert from "node:assert/strict";

import type { DurableObjectStorageBinding } from "../../shared/types/bindings.ts";
import {
  assertNotifierSnapshotBudget,
  loadNotifierSnapshot,
  MAX_NOTIFIER_SNAPSHOT_BYTES,
  NOTIFIER_CHUNK_BYTES,
  NotifierCapacityError,
  persistNotifierSnapshot,
  readNotifierBlob,
  stageNotifierBlob,
  type NotifierBlobRef,
} from "./notifier-journal.ts";

type PutHook = (key: string, value: unknown) => Promise<void> | void;

function createStorage(
  initial = new Map<string, unknown>(),
  beforePut?: PutHook,
  afterPut?: PutHook,
) {
  const values = initial;
  let writes = 0;
  let listEntriesRead = 0;
  const listLimits: number[] = [];
  const binding = {
    async get<T>(key: string): Promise<T | undefined> {
      const value = values.get(key);
      return value === undefined ? undefined : structuredClone(value) as T;
    },
    async put(key: string, value: unknown): Promise<void> {
      await beforePut?.(key, value);
      writes += 1;
      values.set(key, structuredClone(value));
      await afterPut?.(key, value);
    },
    async list(options: Record<string, unknown> = {}): Promise<Map<string, unknown>> {
      const prefix = typeof options.prefix === "string" ? options.prefix : "";
      const limit = typeof options.limit === "number" ? options.limit : 1000;
      listLimits.push(limit);
      const entries = [...values.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right))
        .slice(0, limit);
      listEntriesRead += entries.length;
      return new Map(entries);
    },
    async delete(keys: string | string[]): Promise<number> {
      const list = Array.isArray(keys) ? keys : [keys];
      let deleted = 0;
      for (const key of list) if (values.delete(key)) deleted += 1;
      return deleted;
    },
    async setAlarm(): Promise<void> {},
    async getAlarm(): Promise<number | null> {
      return null;
    },
  };
  return {
    binding: binding as unknown as DurableObjectStorageBinding,
    values,
    get writes() {
      return writes;
    },
    get listEntriesRead() { return listEntriesRead; },
    get listLimits() { return listLimits.slice(); },
  };
}

function candidateStorage(
  storage: DurableObjectStorageBinding,
  candidateHead: unknown,
): DurableObjectStorageBinding {
  return {
    ...storage,
    async get<T>(key: string): Promise<T | undefined> {
      if (key === "bufferState") return structuredClone(candidateHead) as T;
      return storage.get<T>(key);
    },
  };
}

function randomAscii(bytes: number): Uint8Array {
  const value = new Uint8Array(bytes);
  for (let index = 0; index < value.length; index += 1) {
    value[index] = 32 + (index % 95);
  }
  return value;
}

test("notifier journal stages exact large Unicode bytes in bounded immutable chunks", async () => {
  const storage = createStorage();
  const source = new TextEncoder().encode("🧪状態/данные/معلومات/".repeat(12_000));
  const ref = await stageNotifierBlob(storage.binding, source);
  const restored = new Uint8Array(await readNotifierBlob(storage.binding, ref));

  assert.deepEqual(restored, source);
  assert.equal(ref.bytes, source.byteLength);
  assert.equal(ref.chunks.length, Math.ceil(ref.bytes / NOTIFIER_CHUNK_BYTES));
  assert.ok(storage.values.size <= ref.chunks.length);
});

test("notifier journal preserves every byte across padded and split chunks", async () => {
  for (const length of [256, 257, 258, NOTIFIER_CHUNK_BYTES + 257]) {
    const storage = createStorage();
    const source = Uint8Array.from({ length }, (_, index) => index % 256);
    const ref = await stageNotifierBlob(storage.binding, source);
    const restored = new Uint8Array(await readNotifierBlob(storage.binding, ref));

    assert.deepEqual(restored, source);
    assert.equal(ref.bytes, length);
    assert.equal(ref.chunks.length, Math.ceil(length / NOTIFIER_CHUNK_BYTES));
  }
});

test("notifier journal budget rejects snapshots beyond byte and chunk ceilings before staging", async () => {
  const storage = createStorage();
  const tooLarge = { value: "x".repeat(MAX_NOTIFIER_SNAPSHOT_BYTES) };

  assert.throws(
    () => assertNotifierSnapshotBudget(tooLarge),
    NotifierCapacityError,
  );
  await assert.rejects(
    stageNotifierBlob(storage.binding, new Uint8Array(MAX_NOTIFIER_SNAPSHOT_BYTES + 1)),
    NotifierCapacityError,
  );
  assert.throws(
    () => assertNotifierSnapshotBudget(
      { valid: true },
      Array.from({ length: 129 }, () => ({
        bytes: NOTIFIER_CHUNK_BYTES,
        digest: "a".repeat(64),
        chunks: ["a".repeat(64)],
      })),
    ),
    NotifierCapacityError,
  );
  assert.equal(storage.writes, 0);
});

test("notifier journal has one ambiguous head commit point for both write outcomes", async () => {
  for (const outcome of ["before-commit", "after-commit"] as const) {
    const candidate = { eventIdCounter: 27, eventBuffer: [{ id: 27 }] };
    let hooked!: ReturnType<typeof createStorage>;
    const inspectCandidate = async (key: string, value: unknown) => {
      if (key !== "bufferState" || !value || typeof value !== "object" ||
        (value as { schemaVersion?: unknown }).schemaVersion !== 2) return;
      const stagedSnapshot = await loadNotifierSnapshot(
        candidateStorage(hooked.binding, value),
        "run",
      );
      assert.deepEqual(stagedSnapshot, candidate);
    };
    hooked = outcome === "before-commit"
      ? createStorage(new Map(), async (key, value) => {
        await inspectCandidate(key, value);
        if (key === "bufferState" && (value as { schemaVersion?: unknown })?.schemaVersion === 2) {
          throw new Error("injected pre-commit head failure");
        }
      })
      : createStorage(new Map(), undefined, async (key, value) => {
        await inspectCandidate(key, value);
        if (key === "bufferState" && (value as { schemaVersion?: unknown })?.schemaVersion === 2) {
          throw new Error("injected ambiguous post-commit head failure");
        }
      });

    if (outcome === "before-commit") {
      await assert.rejects(
        persistNotifierSnapshot(hooked.binding, "run", candidate),
        /pre-commit/,
      );
      assert.equal(await loadNotifierSnapshot(hooked.binding, "run"), undefined);
    } else {
      await assert.rejects(
        persistNotifierSnapshot(hooked.binding, "run", candidate),
        /post-commit/,
      );
      assert.deepEqual(
        await loadNotifierSnapshot(hooked.binding, "run"),
        candidate,
      );
    }
  }
});

test("notifier journal cannot replace a legacy head when immutable chunk staging fails", async () => {
  const legacy = { eventIdCounter: 8, eventBuffer: [{ id: 8 }] };
  let rejectedChunk = false;
  const storage = createStorage(
    new Map([[
      "bufferState",
      { schemaVersion: 1, kind: "run", snapshot: legacy },
    ]]),
    (key) => {
      if (!rejectedChunk && key.startsWith("notifier-v2/chunks/")) {
        rejectedChunk = true;
        throw new Error("injected chunk staging failure");
      }
    },
  );

  await assert.rejects(
    persistNotifierSnapshot(storage.binding, "run", {
      eventIdCounter: 9,
      eventBuffer: [{ id: 9 }],
    }),
    /chunk staging/,
  );
  assert.equal(rejectedChunk, true);
  assert.deepEqual(
    await loadNotifierSnapshot(storage.binding, "run"),
    { schemaVersion: 1, kind: "run", snapshot: legacy },
  );
});

test("post-head live chunk corruption refuses ACK and preserves prior repair copies", async () => {
  let corruptNextHead = false;
  const storage = createStorage(new Map(), undefined, (key, raw) => {
    if (!corruptNextHead || key !== "bufferState") return;
    const head = raw as { snapshot: { chunks: string[] } };
    storage.values.set(`notifier-v2/chunks/${head.snapshot.chunks[0]}`, "Y29ycnVwdA==");
  });
  await persistNotifierSnapshot(storage.binding, "notification", { version: "accepted" });
  const before = structuredClone(storage.values);
  corruptNextHead = true;
  await assert.rejects(
    persistNotifierSnapshot(storage.binding, "notification", { version: "candidate" }),
    /chunk.integrity/,
  );
  for (const [key, value] of before) {
    if (key !== "bufferState") assert.deepEqual(storage.values.get(key), value);
  }
  await assert.rejects(loadNotifierSnapshot(storage.binding, "notification"), /chunk.integrity/);
});

test("notifier journal rejects missing or corrupt live chunks before returning a snapshot", async () => {
  for (const damage of ["missing", "corrupt"] as const) {
    const storage = createStorage();
    const snapshot = { eventIdCounter: 44, eventBuffer: [{ id: 44 }] };
    await persistNotifierSnapshot(storage.binding, "run", snapshot);
    const head = await storage.binding.get<Record<string, unknown>>("bufferState");
    assert.ok(head && typeof head === "object");
    const ref = (head as { snapshot: NotifierBlobRef }).snapshot;
    const key = `notifier-v2/chunks/${ref.chunks[0]}`;
    if (damage === "missing") {
      await storage.binding.delete(key);
    } else {
      await storage.binding.put(key, "corrupt-not-base64");
    }

    await assert.rejects(loadNotifierSnapshot(storage.binding, "run"));
  }
});

test("notifier journal verifies the immutable auxiliary blobs named by flush intents", async () => {
  const storage = createStorage();
  const payload = randomAscii(NOTIFIER_CHUNK_BYTES + 19);
  const blob = await stageNotifierBlob(storage.binding, payload);
  const intent = { segmentIndex: 2, blob };
  const snapshot = { eventIdCounter: 151, flushIntents: [intent] };

  await persistNotifierSnapshot(storage.binding, "run", snapshot, [blob]);
  assert.deepEqual(await loadNotifierSnapshot(storage.binding, "run"), snapshot);
  const unclosed = createStorage();
  await persistNotifierSnapshot(unclosed.binding, "run", { eventIdCounter: 1 });
  const unclosedBlob = await stageNotifierBlob(unclosed.binding, payload);
  const unclosedSnapshot = {
    eventIdCounter: 151,
    flushIntents: [{ segmentIndex: 2, blob: unclosedBlob }],
  };
  const beforeRejectedWrite = structuredClone([...unclosed.values.entries()]);
  const writesBeforeRejectedWrite = unclosed.writes;
  await assert.rejects(
    persistNotifierSnapshot(unclosed.binding, "run", unclosedSnapshot),
    /blobClosure/,
  );
  assert.equal(unclosed.writes, writesBeforeRejectedWrite);
  assert.deepEqual([...unclosed.values.entries()], beforeRejectedWrite);
});

test("successful commit garbage-collects failed-stage orphans but preserves the accepted blob", async () => {
  let rejectHead = false;
  const storage = createStorage(new Map(), (key) => {
    if (rejectHead && key === "bufferState") {
      rejectHead = false;
      throw new Error("injected ambiguous commit before head write");
    }
  });
  const acceptedBlob = await stageNotifierBlob(storage.binding, new TextEncoder().encode("accepted archive bytes"));
  const acceptedSnapshot = {
    eventIdCounter: 10,
    flushIntents: [{ blob: acceptedBlob }],
  };
  await persistNotifierSnapshot(storage.binding, "run", acceptedSnapshot, [acceptedBlob]);
  const oldHead = await storage.binding.get<Record<string, unknown>>("bufferState");
  const acceptedChunkKeys = acceptedBlob.chunks.map((digest) => `notifier-v2/chunks/${digest}`);
  const stagedOrphan = await stageNotifierBlob(
    storage.binding,
    new TextEncoder().encode("orphan from failed head commit"),
  );
  const orphanChunkKeys = stagedOrphan.chunks.map((digest) => `notifier-v2/chunks/${digest}`);
  rejectHead = true;
  await assert.rejects(
    persistNotifierSnapshot(storage.binding, "run", { eventIdCounter: 11 }),
    /before head write/,
  );
  assert.deepEqual(await storage.binding.get("bufferState"), oldHead);
  const limitsBeforeCommit = storage.listLimits.length;

  await persistNotifierSnapshot(storage.binding, "run", {
    eventIdCounter: 11,
    flushIntents: [{ blob: acceptedBlob }],
  }, [acceptedBlob]);

  const newHead = await storage.binding.get<{
    snapshot: NotifierBlobRef;
    blobs: NotifierBlobRef[];
  }>("bufferState");
  assert.ok(newHead);
  const currentKeys = [newHead.snapshot, ...newHead.blobs]
    .flatMap((ref) => ref.chunks.map((digest) => `notifier-v2/chunks/${digest}`));
  for (const key of currentKeys) assert.ok(storage.values.has(key), `missing live chunk ${key}`);
  for (const key of orphanChunkKeys) assert.equal(storage.values.has(key), false, `orphan survived: ${key}`);
  for (const key of acceptedChunkKeys) assert.ok(storage.values.has(key), `accepted blob removed: ${key}`);
  assert.deepEqual(await loadNotifierSnapshot(storage.binding, "run"), {
    eventIdCounter: 11,
    flushIntents: [{ blob: acceptedBlob }],
  });
  assert.equal(storage.listLimits.length, limitsBeforeCommit + 1);
  assert.deepEqual(storage.listLimits, [256, 256]);
  assert.ok(storage.listEntriesRead <= 256);
});

test("notifier chunk cleanup bounds each sorted scan to 256 entries", async () => {
  const storage = createStorage();
  await persistNotifierSnapshot(storage.binding, "run", { eventIdCounter: 1 });
  const readsBeforeBoundedScan = storage.listEntriesRead;
  for (let index = 0; index < 300; index += 1) {
    const digest = index.toString(16).padStart(64, "0");
    storage.values.set(`notifier-v2/chunks/${digest}`, "eA==");
  }

  await persistNotifierSnapshot(storage.binding, "run", { eventIdCounter: 2 });

  assert.deepEqual(storage.listLimits, [256, 256]);
  assert.ok(storage.listEntriesRead - readsBeforeBoundedScan <= 256);
  const head = await storage.binding.get<{ snapshot: NotifierBlobRef; blobs: NotifierBlobRef[] }>("bufferState");
  assert.ok(head);
  for (const ref of [head.snapshot, ...head.blobs]) {
    for (const digest of ref.chunks) {
      assert.ok(storage.values.has(`notifier-v2/chunks/${digest}`));
    }
  }
  assert.equal(storage.values.size, 46 + head.snapshot.chunks.length);
});
