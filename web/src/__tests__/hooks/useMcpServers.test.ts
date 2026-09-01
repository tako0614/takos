import { afterEach, expect, test } from "bun:test";
import { createRoot, createSignal, type Setter } from "solid-js";
import {
  McpScopeChangedError,
  useMcpServers,
} from "../../hooks/useMcpServers.ts";
import { useConfirmDialogActions } from "../../store/confirm-dialog.ts";

function server(overrides: Record<string, unknown> = {}) {
  return {
    id: "server-1",
    name: "docs",
    url: "https://connector.example/mcp",
    transport: "streamable-http",
    enabled: true,
    source_type: "external",
    auth_mode: "none",
    service_id: null,
    bundle_deployment_id: null,
    managed: false,
    scope: null,
    issuer_url: null,
    registration_mode: null,
    authorization_status: "not_required",
    token_expires_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    updated_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function inventoryResponse(servers: unknown[]): Response {
  return new Response(JSON.stringify({ data: servers }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  return input instanceof Request ? input.method : (init?.method ?? "GET");
}

afterEach(() => {
  useConfirmDialogActions().handleCancel();
});

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("MCP refresh keeps verified connections visible while revalidating", async () => {
  const originalFetch = globalThis.fetch;
  const revalidation = deferredResponse();
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve(inventoryResponse([server()]))
      : revalidation.promise;
  }) as unknown as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let state: ReturnType<typeof useMcpServers> | undefined;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [spaceId] = createSignal("space-a");
      state = useMcpServers({ spaceId });
    });
    await state!.refresh();

    const refresh = state!.refresh();
    expect(state!.loading()).toBe(true);
    expect(state!.servers().map((entry) => entry.id)).toEqual(["server-1"]);
    expect(state!.hasVerifiedInventory()).toBe(true);

    revalidation.resolve(
      inventoryResponse([server({ name: "docs updated" })]),
    );
    await refresh;
    expect(state!.servers()[0]?.name).toBe("docs updated");
    expect(state!.loading()).toBe(false);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("MCP refresh failure preserves last-known-good inventory with an error", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve(inventoryResponse([server()]))
      : Promise.reject(new Error("connection inventory unavailable"));
  }) as unknown as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let state: ReturnType<typeof useMcpServers> | undefined;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [spaceId] = createSignal("space-a");
      state = useMcpServers({ spaceId });
    });
    await state!.refresh();
    await state!.refresh();

    expect(state!.servers().map((entry) => entry.id)).toEqual(["server-1"]);
    expect(state!.hasVerifiedInventory()).toBe(true);
    expect(state!.error()).toBe("connection inventory unavailable");
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("MCP inventory never leaks across a Workspace change", async () => {
  const originalFetch = globalThis.fetch;
  const nextWorkspace = deferredResponse();
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return calls === 1
      ? Promise.resolve(inventoryResponse([server()]))
      : nextWorkspace.promise;
  }) as unknown as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let state: ReturnType<typeof useMcpServers> | undefined;
    let setSpaceId!: Setter<string>;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [spaceId, updateSpaceId] = createSignal("space-a");
      setSpaceId = updateSpaceId;
      state = useMcpServers({ spaceId });
    });
    await state!.refresh();

    setSpaceId("space-b");
    const refresh = state!.refresh();
    expect(state!.servers()).toEqual([]);
    expect(state!.hasVerifiedInventory()).toBe(false);
    expect(state!.loading()).toBe(true);

    nextWorkspace.resolve(
      inventoryResponse([server({ id: "server-2", name: "calendar" })]),
    );
    await refresh;
    expect(state!.servers().map((entry) => entry.id)).toEqual(["server-2"]);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("MCP delete confirmation is revalidated after the Workspace changes", async () => {
  const originalFetch = globalThis.fetch;
  let deleteCalls = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (requestMethod(input, init) === "DELETE") {
      deleteCalls += 1;
      return Promise.resolve(Response.json({ success: true }));
    }
    return Promise.resolve(inventoryResponse([server()]));
  }) as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let state: ReturnType<typeof useMcpServers> | undefined;
    let setSpaceId!: Setter<string>;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [spaceId, updateSpaceId] = createSignal("space-a");
      setSpaceId = updateSpaceId;
      state = useMcpServers({ spaceId });
    });
    await state!.refresh();

    const deletion = state!.deleteServer(state!.servers()[0]!);
    setSpaceId("space-b");
    useConfirmDialogActions().handleConfirm();
    expect(await deletion).toBe(false);
    expect(deleteCalls).toBe(0);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("MCP mutation response stays stale after a Workspace A-B-A switch", async () => {
  const originalFetch = globalThis.fetch;
  const creation = deferredResponse();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (requestMethod(input, init) === "POST") return creation.promise;
    return Promise.resolve(inventoryResponse([]));
  }) as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let state: ReturnType<typeof useMcpServers> | undefined;
    let setSpaceId!: Setter<string>;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [spaceId, updateSpaceId] = createSignal("space-a");
      setSpaceId = updateSpaceId;
      state = useMcpServers({ spaceId });
    });
    await state!.refresh();

    const create = state!.createExternalServer({
      name: "docs",
      url: "https://connector.example/mcp",
    });
    setSpaceId("space-b");
    // The browser's scope effect refreshes on every Workspace transition. Call
    // the same boundary explicitly under Bun's non-browser Solid runtime.
    await state!.refresh();
    setSpaceId("space-a");
    creation.resolve(
      Response.json({
        data: {
          status: "registered",
          name: "docs",
          url: "https://connector.example/mcp",
          message: "Connected",
        },
      }),
    );

    await expect(create).rejects.toBeInstanceOf(McpScopeChangedError);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("MCP delete rejects a malformed success body", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (requestMethod(input, init) === "DELETE") {
      return Promise.resolve(Response.json({ success: false }));
    }
    return Promise.resolve(inventoryResponse([server()]));
  }) as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    let state: ReturnType<typeof useMcpServers> | undefined;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [spaceId] = createSignal("space-a");
      state = useMcpServers({ spaceId });
    });
    await state!.refresh();

    const deletion = state!.deleteServer(state!.servers()[0]!);
    useConfirmDialogActions().handleConfirm();
    expect(await deletion).toBe(false);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});
