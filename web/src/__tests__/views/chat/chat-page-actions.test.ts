import { expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";
import { createChatPageActions } from "../../../views/chat/chat-page-actions.ts";
import type { Thread } from "../../../types/index.ts";

if (Bun.env.TAKOS_CHAT_PAGE_ACTIONS_CLIENT !== "1") {
  test("chat page actions run with Solid browser lifetimes", async () => {
    const child = Bun.spawn([
      process.execPath, "--conditions=browser", "test", import.meta.path,
    ], {
      env: { ...process.env, TAKOS_CHAT_PAGE_ACTIONS_CLIENT: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
    expect(code).toBe(0);
  });
} else {
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  type Options = Parameters<typeof createChatPageActions>[0];
  function setup(api: Partial<Pick<Options, "loadThread" | "createThread">>) {
    const selected: Parameters<Options["onSearchSelected"]>[0][] = [];
    const created: Parameters<Options["onCreated"]>[0][] = [];
    const errors: { error: unknown; fallback: string }[] = [];
    let dispose!: () => void;
    const fixture = createRoot((cleanup) => {
      dispose = cleanup;
      const [spaceId, setSpaceId] = createSignal<string | null>("space-a");
      const [threadId, setThreadId] = createSignal<string | undefined>("thread-a");
      const actions = createChatPageActions({
        spaceId, threadId, selectedModel: () => "model-a",
        loadThread: api.loadThread ?? (() => { throw new Error("Unexpected search"); }),
        createThread: api.createThread ?? (() => { throw new Error("Unexpected create"); }),
        onCreated: (selection) => created.push(selection),
        onSearchSelected: (selection) => selected.push(selection),
        onError: (error, fallback) => errors.push({ error, fallback }),
      });
      return { ...actions, setSpaceId, setThreadId };
    });
    return { ...fixture, selected, created, errors, dispose };
  }

  test("a search result cannot replace the conversation selected while it loaded", async () => {
    const response = deferred<Response>();
    const selected: unknown[] = [];
    let dispose!: () => void;
    const fixture = createRoot((cleanup) => {
      dispose = cleanup;
      const [threadId, setThreadId] = createSignal<string | undefined>("thread-a");
      const actions = createChatPageActions({
        spaceId: () => "space-a", threadId, selectedModel: () => "model-a",
        loadThread: () => response.promise,
        createThread: () => { throw new Error("No create expected"); },
        onCreated: () => { throw new Error("No create expected"); },
        onSearchSelected: (selection) => selected.push(selection),
        onError: (error) => { throw error; },
      });
      return { ...actions, setThreadId };
    });
    try {
      const pending = fixture.openSearchResult("search-thread", "message-a", 7);
      fixture.setThreadId("thread-b");
      response.resolve(Response.json({ thread: { id: "search-thread" } as Thread }));
      await pending;
      expect(selected).toEqual([]);
    } finally {
      dispose();
    }
  });

  test("creating in one Workspace cannot open its response after switching Workspace", async () => {
    const response = deferred<Response>();
    const created: unknown[] = [];
    const requests: unknown[] = [];
    let dispose!: () => void;
    const fixture = createRoot((cleanup) => {
      dispose = cleanup;
      const [spaceId, setSpaceId] = createSignal<string | null>("space-a");
      const actions = createChatPageActions({
        spaceId, threadId: () => undefined, selectedModel: () => "model-a",
        loadThread: () => { throw new Error("No search expected"); },
        createThread: (space, message) => {
          requests.push({ space, message });
          return response.promise;
        },
        onCreated: (selection) => created.push(selection),
        onSearchSelected: () => { throw new Error("No search expected"); },
        onError: (error) => { throw error; },
      });
      return { ...actions, setSpaceId };
    });
    try {
      const pending = fixture.handleCreateThread("Original A draft");
      fixture.setSpaceId("space-b");
      response.resolve(Response.json({ thread: { id: "created-in-a" } as Thread }));
      await pending;
      expect(requests).toEqual([{ space: "space-a", message: "Original A draft" }]);
      expect(created).toEqual([]);
    } finally {
      dispose();
    }
  });

  test("the first message retains the model selected when creation was requested", async () => {
    const response = deferred<Response>();
    const created: unknown[] = [];
    const files = [new File(["draft"], "draft.txt")];
    let dispose!: () => void;
    const fixture = createRoot((cleanup) => {
      dispose = cleanup;
      const [model, setModel] = createSignal("model-a");
      const actions = createChatPageActions({
        spaceId: () => "space-a", threadId: () => undefined, selectedModel: model,
        loadThread: () => { throw new Error("No search expected"); },
        createThread: () => response.promise,
        onCreated: (selection) => created.push(selection),
        onSearchSelected: () => { throw new Error("No search expected"); },
        onError: (error) => { throw error; },
      });
      return { ...actions, setModel };
    });
    try {
      const pending = fixture.handleCreateThread("Original draft", files);
      fixture.setModel("model-b");
      const thread = { id: "created-in-a" } as Thread;
      response.resolve(Response.json({ thread: thread }));
      await pending;
      expect(created).toEqual([{
        spaceId: "space-a", thread, message: "Original draft", files, model: "model-a",
      }]);
    } finally {
      dispose();
    }
  });

  test("returning to the original route does not revive its abandoned search", async () => {
    const response = deferred<Response>();
    const fixture = setup({ loadThread: () => response.promise });
    try {
      const pending = fixture.openSearchResult("old-result", "old-message", 3);
      fixture.setThreadId("thread-b");
      fixture.setThreadId("thread-a");
      response.resolve(Response.json({ thread: { id: "old-result" } as Thread }));
      await pending;
      expect(fixture.selected).toEqual([]);
      expect(fixture.errors).toEqual([]);
    } finally { fixture.dispose(); }
  });

  test("the latest search selection wins out-of-order responses and keeps its deep link", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const calls: string[] = [];
    const fixture = setup({
      loadThread: (id) => { calls.push(id); return id === "first" ? first.promise : second.promise; },
    });
    try {
      const pendingFirst = fixture.openSearchResult("first", "message-first", 2);
      const pendingSecond = fixture.openSearchResult("second", "message-second", 19);
      const thread = { id: "second" } as Thread;
      second.resolve(Response.json({ thread: thread }));
      await pendingSecond;
      first.resolve(Response.json({ thread: { id: "first" } as Thread }));
      await pendingFirst;
      expect(calls).toEqual(["first", "second"]);
      expect(fixture.selected).toEqual([{ thread, messageId: "message-second", sequence: 19 }]);
      expect(fixture.errors).toEqual([]);
    } finally { fixture.dispose(); }
  });

  test.each(["create", "search"] as const)("an unmounted page ignores a late %s success", async (action) => {
    const response = deferred<Response>();
    const fixture = setup({ loadThread: () => response.promise, createThread: () => response.promise });
    const pending = action === "create"
      ? fixture.handleCreateThread("Original draft")
      : fixture.openSearchResult("result", "message", 1);
    fixture.dispose();
    response.resolve(Response.json({ thread: { id: "retired-thread" } as Thread }));
    await pending;
    expect(fixture.selected).toEqual([]);
    expect(fixture.created).toEqual([]);
    expect(fixture.errors).toEqual([]);
  });

  test.each(["create", "search"] as const)("a retired page ignores a late %s failure", async (action) => {
    const response = deferred<Response>();
    const fixture = setup({ loadThread: () => response.promise, createThread: () => response.promise });
    try {
      const pending = action === "create"
        ? fixture.handleCreateThread("Original draft")
        : fixture.openSearchResult("result", "message", 1);
      fixture.setSpaceId("space-b");
      response.reject(new Error("Old request failed"));
      await pending;
      expect(fixture.selected).toEqual([]);
      expect(fixture.created).toEqual([]);
      expect(fixture.errors).toEqual([]);
    } finally { fixture.dispose(); }
  });

  test("a current failure is visible and manual retry works without automatic replay", async () => {
    const error = new Error("Creation unavailable");
    const thread = { id: "retry-thread" } as Thread;
    let calls = 0;
    const fixture = setup({
      createThread: () => ++calls === 1 ? Promise.reject(error) : Promise.resolve(Response.json({ thread })),
    });
    try {
      await fixture.handleCreateThread("Draft to retry");
      expect(calls).toBe(1);
      expect(fixture.created).toEqual([]);
      expect(fixture.errors).toEqual([{ error, fallback: "failedToCreate" }]);
      await fixture.handleCreateThread("Draft to retry");
      expect(calls).toBe(2);
      expect(fixture.created).toEqual([{
        spaceId: "space-a", thread, message: "Draft to retry", files: undefined, model: "model-a",
      }]);
    } finally { fixture.dispose(); }
  });

  test("a newer search retires creation in the same page without replaying it", async () => {
    const response = deferred<Response>();
    const fixture = setup({
      createThread: () => response.promise,
      loadThread: async () => Response.json({ thread: { id: "selected-search" } }),
    });
    try {
      const pending = fixture.handleCreateThread("Old creation");
      await fixture.openSearchResult("selected-search", "selected-message", 4);
      response.resolve(Response.json({ thread: { id: "created-thread" } as Thread }));
      await pending;
      expect(fixture.created).toEqual([]);
      expect(fixture.selected.map(({ thread }) => thread.id)).toEqual(["selected-search"]);
      expect(fixture.errors).toEqual([]);
    } finally { fixture.dispose(); }
  });

  test.each(["create", "search"] as const)("a retired %s's delayed 401 body cannot navigate the current page to login", async (action) => {
    const body = deferred<unknown>();
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    const response = { ok: false, status: 401, json: () => { reading(); return body.promise; } };
    // This file runs in its own browser-condition child. Give the actual RPC
    // decoder a local browser location, without replacing fetch or modules.
    const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/chat/space-b", pathname: "/chat/space-b", search: "" };
    Object.defineProperty(globalThis, "location", { configurable: true, value: location });
    const fixture = setup({ createThread: async () => response, loadThread: async () => response });
    try {
      const pending = action === "create"
        ? fixture.handleCreateThread("Old draft")
        : fixture.openSearchResult("old-result", "old-message", 8);
      await started;
      fixture.setSpaceId("space-b");
      body.resolve({ error: { code: "UNAUTHORIZED", message: "Old session expired" } });
      await pending;
      expect(location.href).toBe("/chat/space-b");
      expect(fixture.errors).toEqual([]);
      expect(fixture.created).toEqual([]);
    } finally {
      fixture.dispose();
      if (previous) Object.defineProperty(globalThis, "location", previous);
      else Reflect.deleteProperty(globalThis, "location");
    }
  });

  test("a current 401 still redirects with its return URL and reports the error", async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "location");
    const location = { href: "/chat/space-a/thread-a?message=m", pathname: "/chat/space-a/thread-a", search: "?message=m" };
    Object.defineProperty(globalThis, "location", { configurable: true, value: location });
    const fixture = setup({
      loadThread: async () => Response.json({ error: { code: "UNAUTHORIZED", message: "Session expired" } }, { status: 401 }),
    });
    try {
      await fixture.openSearchResult("result", "message", 8);
      expect(location.href).toBe("/auth/oidc/login?return_to=%2Fchat%2Fspace-a%2Fthread-a%3Fmessage%3Dm");
      expect(fixture.selected).toEqual([]);
      expect(fixture.errors).toHaveLength(1);
      expect(fixture.errors[0].fallback).toBe("failedToLoad");
      expect((fixture.errors[0].error as Error).message).toBe("Session expired");
    } finally {
      fixture.dispose();
      if (previous) Object.defineProperty(globalThis, "location", previous);
      else Reflect.deleteProperty(globalThis, "location");
    }
  });

  test("a successful body that finishes after navigation cannot change the current selection", async () => {
    const body = deferred<unknown>();
    let reading!: () => void;
    const started = new Promise<void>((resolve) => { reading = resolve; });
    const response = { ok: true, status: 200, json: () => { reading(); return body.promise; } };
    const fixture = setup({ loadThread: async () => response });
    try {
      const pending = fixture.openSearchResult("old-result", "old-message", 8);
      await started;
      fixture.setThreadId("thread-b");
      body.resolve({ thread: { id: "old-result" } });
      await pending;
      expect(fixture.selected).toEqual([]);
      expect(fixture.errors).toEqual([]);
    } finally { fixture.dispose(); }
  });
}
