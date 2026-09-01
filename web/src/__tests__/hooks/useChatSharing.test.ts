import { afterEach, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { useChatSharing } from "../../hooks/useChatSharing.ts";
import { useConfirmDialogActions } from "../../store/confirm-dialog.ts";

const origin = "http://localhost";

function rawShare(
  id: string,
  threadId = "thread-a",
  spaceId = "space-a",
  overrides: Record<string, unknown> = {},
) {
  const token = id.padEnd(32, "A").slice(0, 32);
  return {
    id,
    thread_id: threadId,
    space_id: spaceId,
    created_by: "user-1",
    token,
    mode: "public",
    expires_at: null,
    revoked_at: null,
    last_accessed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function linkedShare(
  id: string,
  threadId = "thread-a",
  spaceId = "space-a",
  overrides: Record<string, unknown> = {},
) {
  const raw = rawShare(id, threadId, spaceId, overrides);
  return {
    ...raw,
    share_path: `/share/${raw.token}`,
    share_url: `${origin}/share/${raw.token}`,
  };
}

function inventoryResponse(shares: unknown[]): Response {
  return Response.json({ shares });
}

function createResponse(id: string): Response {
  const share = rawShare(id);
  return Response.json({
    share,
    share_path: `/share/${share.token}`,
    share_url: `${origin}/share/${share.token}`,
    password_required: false,
  }, { status: 201 });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return input instanceof Request ? input.method : (init?.method ?? "GET");
}

afterEach(() => {
  useConfirmDialogActions().handleCancel();
});

test("Thread share refresh drops an older response for the same Thread", async () => {
  const originalFetch = globalThis.fetch;
  const older = deferredResponse();
  const newer = deferredResponse();
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return calls === 1 ? older.promise : newer.promise;
  }) as unknown as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let sharing: ReturnType<typeof useChatSharing> | undefined;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [threadId] = createSignal("thread-a");
      const [spaceId] = createSignal("space-a");
      sharing = useChatSharing(threadId, spaceId);
    });

    const first = sharing!.fetchShares();
    const second = sharing!.fetchShares();
    newer.resolve(inventoryResponse([linkedShare("share-new")]));
    await second;
    expect(sharing!.shares().map((share) => share.id)).toEqual(["share-new"]);

    older.resolve(inventoryResponse([linkedShare("share-old")]));
    await first;
    expect(sharing!.shares().map((share) => share.id)).toEqual(["share-new"]);
    expect(sharing!.sharesLoading()).toBe(false);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("closing and reopening Share cannot release an in-flight create", async () => {
  const originalFetch = globalThis.fetch;
  const creation = deferredResponse();
  let createCalls = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (requestMethod(input, init) === "POST") {
      createCalls += 1;
      return creation.promise;
    }
    return Promise.resolve(inventoryResponse([]));
  }) as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let sharing: ReturnType<typeof useChatSharing> | undefined;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [threadId] = createSignal("thread-a");
      const [spaceId] = createSignal("space-a");
      sharing = useChatSharing(threadId, spaceId);
    });

    sharing!.setShowShareModal(true);
    await Promise.resolve();
    const first = sharing!.createShare();
    expect(sharing!.creatingShare()).toBe(true);
    sharing!.setShowShareModal(false);
    sharing!.setShowShareModal(true);
    await sharing!.createShare();
    expect(createCalls).toBe(1);
    expect(sharing!.creatingShare()).toBe(true);

    creation.resolve(createResponse("share-created"));
    await first;
    expect(sharing!.creatingShare()).toBe(false);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("revoke confirmation is revalidated after the Thread changes", async () => {
  const originalFetch = globalThis.fetch;
  let postCalls = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (requestMethod(input, init) === "POST") postCalls += 1;
    return Promise.resolve(inventoryResponse([linkedShare("share-1")]));
  }) as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let sharing: ReturnType<typeof useChatSharing> | undefined;
    let setThreadId!: (value: string) => void;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [threadId, updateThreadId] = createSignal("thread-a");
      const [spaceId] = createSignal("space-a");
      setThreadId = updateThreadId;
      sharing = useChatSharing(threadId, spaceId);
    });
    await sharing!.fetchShares();

    const revoke = sharing!.revokeShare("share-1");
    setThreadId("thread-b");
    useConfirmDialogActions().handleConfirm();
    await revoke;
    expect(postCalls).toBe(0);
    expect(sharing!.revokingShareId()).toBeNull();
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("an accepted revoke remains single-flight until its response settles", async () => {
  const originalFetch = globalThis.fetch;
  const revocation = deferredResponse();
  let postCalls = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (requestMethod(input, init) === "POST") {
      postCalls += 1;
      return revocation.promise;
    }
    return Promise.resolve(inventoryResponse([linkedShare("share-1")]));
  }) as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let sharing: ReturnType<typeof useChatSharing> | undefined;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [threadId] = createSignal("thread-a");
      const [spaceId] = createSignal("space-a");
      sharing = useChatSharing(threadId, spaceId);
    });
    await sharing!.fetchShares();

    const first = sharing!.revokeShare("share-1");
    useConfirmDialogActions().handleConfirm();
    await Promise.resolve();
    await Promise.resolve();
    expect(sharing!.revokingShareId()).toBe("share-1");

    await sharing!.revokeShare("share-1");
    expect(postCalls).toBe(1);
    expect(sharing!.revokingShareId()).toBe("share-1");

    revocation.resolve(Response.json({ success: true }));
    await first;
    expect(sharing!.revokingShareId()).toBeNull();
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});
