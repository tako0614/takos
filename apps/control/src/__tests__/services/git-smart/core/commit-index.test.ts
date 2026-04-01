import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { assertEquals } from "jsr:@std/assert";

import {
  findMergeBase,
  isAncestor,
} from "@/application/services/git-smart/core/commit-index.ts";
import { putCommit } from "@/application/services/git-smart/core/object-store.ts";

const REPO_ID = "test-repo";
const ZERO_TREE = "0000000000000000000000000000000000000000";
const UNKNOWN_SHA = "ffffffffffffffffffffffffffffffffffffffff";

type StoredValue = Uint8Array;

class FakeD1PreparedStatement {
  bind(..._values: unknown[]): FakeD1PreparedStatement {
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

class FakeD1Database {
  prepare(_query: string): FakeD1PreparedStatement {
    return new FakeD1PreparedStatement();
  }

  exec(_query: string): Promise<{ count: number; duration: number }> {
    return Promise.resolve({ count: 0, duration: 0 });
  }

  batch<T>(statements: FakeD1PreparedStatement[]): Promise<T[]> {
    return Promise.all(
      statements.map((statement) => statement.run()),
    ) as Promise<
      T[]
    >;
  }

  withSession() {
    return {
      prepare: (query: string) => this.prepare(query),
      batch: <T>(statements: FakeD1PreparedStatement[]) =>
        this.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  dump(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(0));
  }
}

class FakeR2ObjectBody {
  constructor(private readonly bytes: Uint8Array) {}

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer as ArrayBuffer;
  }
}

class FakeR2Bucket {
  #objects = new Map<string, StoredValue>();

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string,
  ): Promise<void> {
    if (typeof value === "string") {
      this.#objects.set(key, new TextEncoder().encode(value));
      return;
    }
    if (value instanceof ArrayBuffer) {
      this.#objects.set(key, new Uint8Array(value));
      return;
    }
    if (ArrayBuffer.isView(value)) {
      this.#objects.set(
        key,
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
      );
      return;
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
  }

  async get(key: string): Promise<FakeR2ObjectBody | null> {
    const value = this.#objects.get(key);
    return value ? new FakeR2ObjectBody(value) : null;
  }

  async head(key: string): Promise<Record<string, never> | null> {
    return this.#objects.has(key) ? {} : null;
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
  const bucket = new FakeR2Bucket();
  const db = new FakeD1Database() as unknown as D1Database;

  const A = await putCommit(bucket as unknown as R2Bucket, {
    tree: ZERO_TREE,
    parents: [],
    author: makeSignature(1),
    committer: makeSignature(1),
    message: "A",
  });
  const E = await putCommit(bucket as unknown as R2Bucket, {
    tree: ZERO_TREE,
    parents: [],
    author: makeSignature(2),
    committer: makeSignature(2),
    message: "E",
  });
  const B = await putCommit(bucket as unknown as R2Bucket, {
    tree: ZERO_TREE,
    parents: [A],
    author: makeSignature(3),
    committer: makeSignature(3),
    message: "B",
  });
  const C = await putCommit(bucket as unknown as R2Bucket, {
    tree: ZERO_TREE,
    parents: [B, E],
    author: makeSignature(4),
    committer: makeSignature(4),
    message: "C",
  });
  const D = await putCommit(bucket as unknown as R2Bucket, {
    tree: ZERO_TREE,
    parents: [C],
    author: makeSignature(5),
    committer: makeSignature(5),
    message: "D",
  });
  const isolated = await putCommit(bucket as unknown as R2Bucket, {
    tree: ZERO_TREE,
    parents: [],
    author: makeSignature(6),
    committer: makeSignature(6),
    message: "isolated",
  });

  return {
    db,
    bucket: bucket as unknown as R2Bucket,
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
