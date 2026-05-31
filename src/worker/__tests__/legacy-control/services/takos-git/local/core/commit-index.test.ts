import type { ObjectStoreBinding } from "@/shared/types/bindings.ts";

import { assertEquals } from "@std/assert";

import {
  findMergeBase,
  isAncestor,
} from "@/application/services/takos-git/local/core/commit-index.ts";
import { putCommit } from "@/application/services/takos-git/local/core/object-store.ts";
import { asTestSqlDatabaseBinding } from "@test/db-stubs";

const REPO_ID = "test-repo";
const ZERO_TREE = "0000000000000000000000000000000000000000";
const UNKNOWN_SHA = "ffffffffffffffffffffffffffffffffffffffff";

type StoredValue = Uint8Array;

class FakeSqlPreparedStatement {
  bind(..._values: unknown[]): FakeSqlPreparedStatement {
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    return null;
  }

  async all<T = unknown>(): Promise<
    { results: T[]; success: boolean; meta: Record<string, unknown> }
  > {
    return { results: [], success: true, meta: {} };
  }

  async run(): Promise<
    {
      success: boolean;
      meta: { changes: number; last_row_id: number; duration: number };
    }
  > {
    return { success: true, meta: { changes: 0, last_row_id: 0, duration: 0 } };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    return [];
  }
}

class FakeSqlDatabaseBinding {
  prepare(_query: string): FakeSqlPreparedStatement {
    return new FakeSqlPreparedStatement();
  }

  exec(_query: string): Promise<{ count: number; duration: number }> {
    return Promise.resolve({ count: 0, duration: 0 });
  }

  batch<T>(statements: FakeSqlPreparedStatement[]): Promise<T[]> {
    return Promise.all(
      statements.map((statement) => statement.run()),
    ) as Promise<
      T[]
    >;
  }

  withSession() {
    return {
      prepare: (query: string) => this.prepare(query),
      batch: <T>(statements: FakeSqlPreparedStatement[]) =>
        this.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

class FakeObjectStoreObjectBody {
  readonly key = "";
  readonly size = 0;
  readonly etag = "";
  readonly httpEtag = "";
  readonly uploaded = new Date(0);
  bodyUsed = false;
  readonly #bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }
  get body(): ReadableStream {
    const buffer = this.#bytes;
    return new ReadableStream({
      start: (controller) => {
        controller.enqueue(buffer);
        controller.close();
      },
    });
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(this.#bytes.slice().buffer as ArrayBuffer);
  }

  text(): Promise<string> {
    return Promise.resolve(new TextDecoder().decode(this.#bytes));
  }

  json<T = unknown>(): Promise<T> {
    return this.text().then((s) => JSON.parse(s) as T);
  }

  blob(): Promise<Blob> {
    return Promise.resolve(
      new Blob([this.#bytes.slice().buffer as ArrayBuffer]),
    );
  }

  bytes(): Promise<Uint8Array> {
    return Promise.resolve(this.#bytes.slice());
  }
}

class FakeObjectStoreBinding implements ObjectStoreBinding {
  #objects = new Map<string, StoredValue>();

  async put(
    key: string,
    value:
      | ReadableStream
      | ArrayBuffer
      | ArrayBufferView
      | string
      | Blob
      | null,
  ): Promise<null> {
    if (value === null) {
      this.#objects.delete(key);
      return null;
    }
    if (typeof value === "string") {
      this.#objects.set(key, new TextEncoder().encode(value));
      return null;
    }
    if (value instanceof ArrayBuffer) {
      this.#objects.set(key, new Uint8Array(value));
      return null;
    }
    if (value instanceof Blob) {
      this.#objects.set(key, new Uint8Array(await value.arrayBuffer()));
      return null;
    }
    if (ArrayBuffer.isView(value)) {
      this.#objects.set(
        key,
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
      return null;
    }
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.#objects.set(key, merged);
    return null;
  }

  async get(key: string): Promise<FakeObjectStoreObjectBody | null> {
    const value = this.#objects.get(key);
    return value ? new FakeObjectStoreObjectBody(value) : null;
  }

  head(key: string): Promise<
    | {
      key: string;
      size: number;
      etag: string;
      httpEtag: string;
      uploaded: Date;
    }
    | null
  > {
    return Promise.resolve(
      this.#objects.has(key)
        ? {
          key,
          size: this.#objects.get(key)!.length,
          etag: "",
          httpEtag: "",
          uploaded: new Date(0),
        }
        : null,
    );
  }

  delete(keys: string | string[]): Promise<void> {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) this.#objects.delete(key);
    return Promise.resolve();
  }

  list(): Promise<
    {
      objects: Array<
        {
          key: string;
          size: number;
          etag: string;
          httpEtag: string;
          uploaded: Date;
        }
      >;
      truncated: boolean;
      delimitedPrefixes: string[];
    }
  > {
    return Promise.resolve({
      objects: [],
      truncated: false,
      delimitedPrefixes: [],
    });
  }
}

function makeSignature(timestamp: number) {
  return {
    name: "Test User",
    email: "test@example.com",
    timestamp,
    tzOffset: "+0000",
  };
}

async function createCommitGraph() {
  const bucket = new FakeObjectStoreBinding();
  const db = asTestSqlDatabaseBinding(new FakeSqlDatabaseBinding());

  const A = await putCommit(bucket, {
    tree: ZERO_TREE,
    parents: [],
    author: makeSignature(1),
    committer: makeSignature(1),
    message: "A",
  });
  const E = await putCommit(bucket, {
    tree: ZERO_TREE,
    parents: [],
    author: makeSignature(2),
    committer: makeSignature(2),
    message: "E",
  });
  const B = await putCommit(bucket, {
    tree: ZERO_TREE,
    parents: [A],
    author: makeSignature(3),
    committer: makeSignature(3),
    message: "B",
  });
  const C = await putCommit(bucket, {
    tree: ZERO_TREE,
    parents: [B, E],
    author: makeSignature(4),
    committer: makeSignature(4),
    message: "C",
  });
  const D = await putCommit(bucket, {
    tree: ZERO_TREE,
    parents: [C],
    author: makeSignature(5),
    committer: makeSignature(5),
    message: "D",
  });
  const isolated = await putCommit(bucket, {
    tree: ZERO_TREE,
    parents: [],
    author: makeSignature(6),
    committer: makeSignature(6),
    message: "isolated",
  });

  return {
    db,
    bucket: bucket,
    A,
    B,
    C,
    D,
    E,
    isolated,
  };
}

Deno.test("isAncestor returns true when SHAs are the same", async () => {
  const graph = await createCommitGraph();

  assertEquals(
    await isAncestor(graph.db, graph.bucket, REPO_ID, graph.A, graph.A),
    true,
  );
});

Deno.test("isAncestor returns true for direct and transitive ancestors", async () => {
  const graph = await createCommitGraph();

  assertEquals(
    await isAncestor(graph.db, graph.bucket, REPO_ID, graph.A, graph.B),
    true,
  );
  assertEquals(
    await isAncestor(graph.db, graph.bucket, REPO_ID, graph.A, graph.D),
    true,
  );
  assertEquals(
    await isAncestor(graph.db, graph.bucket, REPO_ID, graph.E, graph.D),
    true,
  );
});

Deno.test("isAncestor returns false when the ancestor is missing or unrelated", async () => {
  const graph = await createCommitGraph();

  assertEquals(
    await isAncestor(graph.db, graph.bucket, REPO_ID, graph.D, graph.A),
    false,
  );
  assertEquals(
    await isAncestor(graph.db, graph.bucket, REPO_ID, UNKNOWN_SHA, graph.D),
    false,
  );
});

Deno.test("findMergeBase finds the nearest shared ancestor", async () => {
  const graph = await createCommitGraph();

  assertEquals(
    await findMergeBase(graph.db, graph.bucket, REPO_ID, graph.B, graph.D),
    graph.B,
  );
  assertEquals(
    await findMergeBase(graph.db, graph.bucket, REPO_ID, graph.D, graph.E),
    graph.E,
  );
  assertEquals(
    await findMergeBase(graph.db, graph.bucket, REPO_ID, graph.A, graph.B),
    graph.A,
  );
});

Deno.test("findMergeBase returns null when histories are disconnected", async () => {
  const graph = await createCommitGraph();

  assertEquals(
    await findMergeBase(
      graph.db,
      graph.bucket,
      REPO_ID,
      graph.A,
      graph.isolated,
    ),
    null,
  );
});
