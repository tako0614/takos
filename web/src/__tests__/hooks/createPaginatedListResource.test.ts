import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { createRoot, createSignal } from "solid-js";
import { createPaginatedListResource } from "../../hooks/createPaginatedListResource.ts";
import { test } from "bun:test";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("createPaginatedListResource - reset fetch loads the first page and advances offset", async () => {
  let dispose: (() => void) | undefined;
  const calls: number[] = [];
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [source] = createSignal("alice");
        const resource = createPaginatedListResource<string>({
          source,
          initialError: "boom",
          perPage: 2,
          fetchPage: ({ offset }) => {
            calls.push(offset);
            return Promise.resolve({
              items: [`a${offset}`, `b${offset}`],
              hasMore: true,
            });
          },
        });

        void (async () => {
          await resource.fetch(true);
          assertEquals(resource.items(), ["a0", "b0"]);
          assertEquals(resource.hasMore(), true);
          assertEquals(resource.loading(), false);

          // load more: offset advances by perPage, items append.
          await resource.fetch(false);
          assertEquals(calls, [0, 2]);
          assertEquals(resource.items(), ["a0", "b0", "a2", "b2"]);
          done();
        })();
      });
    });
  } finally {
    dispose?.();
  }
});

test("createPaginatedListResource - non-reset fetch is a no-op once hasMore is false", async () => {
  let dispose: (() => void) | undefined;
  let fetchCount = 0;
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [source] = createSignal("alice");
        const resource = createPaginatedListResource<string>({
          source,
          initialError: "boom",
          perPage: 2,
          fetchPage: () => {
            fetchCount += 1;
            return Promise.resolve({ items: ["x"], hasMore: false });
          },
        });

        void (async () => {
          await resource.fetch(true);
          assertEquals(resource.hasMore(), false);
          await resource.fetch(false); // guarded by !hasMore()
          assertEquals(fetchCount, 1);
          done();
        })();
      });
    });
  } finally {
    dispose?.();
  }
});

test("createPaginatedListResource - error fallback surfaces initialError", async () => {
  let dispose: (() => void) | undefined;
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [source] = createSignal("alice");
        const resource = createPaginatedListResource<string>({
          source,
          initialError: "fallback-message",
          fetchPage: () => Promise.reject("not-an-error"),
        });

        void (async () => {
          await resource.fetch(true);
          assertEquals(resource.error(), "fallback-message");
          assertEquals(resource.loading(), false);
          done();
        })();
      });
    });
  } finally {
    dispose?.();
  }
});

test("createPaginatedListResource - stale settlement is dropped after the source changes", async () => {
  let dispose: (() => void) | undefined;
  const first = deferred<{ items: string[]; hasMore: boolean }>();
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [source, setSource] = createSignal("alice");
        const resource = createPaginatedListResource<string>({
          source,
          initialError: "boom",
          fetchPage: () => first.promise,
        });

        void (async () => {
          const inFlight = resource.fetch(true);
          // The source changes (the effect resets items) before settlement.
          setSource("bob");
          // The stale page resolves for "alice" but must be dropped.
          first.resolve({ items: ["stale"], hasMore: true });
          await inFlight;
          assertEquals(resource.items(), []);
          done();
        })();
      });
    });
  } finally {
    dispose?.();
  }
});

test("createPaginatedListResource - reset() clears items/offset/error and re-enables hasMore", async () => {
  let dispose: (() => void) | undefined;
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [source] = createSignal("alice");
        const resource = createPaginatedListResource<string>({
          source,
          initialError: "boom",
          perPage: 2,
          fetchPage: () =>
            Promise.resolve({ items: ["a", "b"], hasMore: false }),
        });

        void (async () => {
          await resource.fetch(true);
          assertEquals(resource.items(), ["a", "b"]);
          assertEquals(resource.hasMore(), false);

          resource.reset();
          assertEquals(resource.items(), []);
          assertEquals(resource.hasMore(), true);
          assertEquals(resource.error(), null);

          // After reset, a non-reset fetch is allowed again (hasMore restored)
          // and a fresh page loads from offset 0.
          await resource.fetch(false);
          assertEquals(resource.items(), ["a", "b"]);
          done();
        })();
      });
    });
  } finally {
    dispose?.();
  }
});

test("createPaginatedListResource - resetPage() clears the page but preserves error", async () => {
  let dispose: (() => void) | undefined;
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const [source] = createSignal("alice");
        let shouldFail = true;
        const resource = createPaginatedListResource<string>({
          source,
          initialError: "load-failed",
          fetchPage: () =>
            shouldFail
              ? Promise.reject(new Error("nope"))
              : Promise.resolve({ items: ["x"], hasMore: true }),
        });

        void (async () => {
          await resource.fetch(true);
          assertEquals(resource.error(), "nope");

          // resetPage clears the list but leaves the surfaced error intact,
          // matching the sort/order reset effect in the follow hooks.
          shouldFail = false;
          resource.resetPage();
          assertEquals(resource.items(), []);
          assertEquals(resource.hasMore(), true);
          assertEquals(resource.error(), "nope");
          done();
        })();
      });
    });
  } finally {
    dispose?.();
  }
});
