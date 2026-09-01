import { expect, test } from "bun:test";
import { createRoot, createSignal, type Setter } from "solid-js";
import { handleTransportClose } from "../../hooks/useConnectionManagerBase.ts";
import { useWsMessageProcessor } from "../../hooks/useWsMessageProcessor.ts";
import type { ThreadHistoryRunSummary } from "../../types/index.ts";

function rawRun(
  id: string,
  threadId: string,
  spaceId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    thread_id: threadId,
    space_id: spaceId,
    session_id: null,
    parent_run_id: null,
    child_thread_id: null,
    root_thread_id: threadId,
    root_run_id: id,
    agent_type: "default",
    model: "gpt-5.5",
    status: "running",
    terminal_reason: null,
    input: "{}",
    output: null,
    error: null,
    usage: "{}",
    worker_id: "worker-1",
    worker_heartbeat: "2026-08-10T00:00:02.000Z",
    started_at: "2026-08-10T00:00:01.000Z",
    completed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function summary(
  id: string,
  threadId: string,
  spaceId: string,
): ThreadHistoryRunSummary {
  return {
    id,
    thread_id: threadId,
    space_id: spaceId,
    session_id: null,
    parent_run_id: null,
    child_thread_id: null,
    root_thread_id: threadId,
    root_run_id: id,
    agent_type: "default",
    model: "gpt-5.5",
    status: "running",
    terminal_reason: null,
    started_at: "2026-08-10T00:00:01.000Z",
    completed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("an old terminal Run status cannot clear the newly selected Run", async () => {
  const originalFetch = globalThis.fetch;
  const oldStatus = deferredResponse();
  globalThis.fetch = (() => oldStatus.promise) as unknown as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    const currentRunIdRef: { current: string | null } = { current: "run-a" };
    let processor: ReturnType<typeof useWsMessageProcessor> | undefined;
    let setThreadId!: Setter<string>;
    let setSpaceId!: Setter<string>;
    let messageRefreshes = 0;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [threadId, updateThreadId] = createSignal("thread-a");
      const [spaceId, updateSpaceId] = createSignal("space-a");
      setThreadId = updateThreadId;
      setSpaceId = updateSpaceId;
      processor = useWsMessageProcessor({
        threadId,
        spaceRecordId: spaceId,
        currentRunIdRef,
        t: (key) => key,
        fetchMessages: async () => {
          messageRefreshes += 1;
        },
      });
    });

    const verification = processor!.verifyRunStatus("run-a");
    setThreadId("thread-b");
    setSpaceId("space-b");
    currentRunIdRef.current = "run-b";
    processor!.setCurrentRun(summary("run-b", "thread-b", "space-b"));
    processor!.setIsLoading(true);

    oldStatus.resolve(Response.json({
      run: rawRun("run-a", "thread-a", "space-a", {
        status: "completed",
        completed_at: "2026-08-10T00:00:03.000Z",
      }),
    }));
    expect(await verification).toBe(false);
    expect(processor!.currentRun?.id).toBe("run-b");
    expect(processor!.isLoading).toBe(true);
    expect(messageRefreshes).toBe(0);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("a transient Run status failure preserves the last verified active state", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("status unavailable"))) as
    unknown as typeof fetch;

  let dispose: (() => void) | undefined;
  try {
    const currentRunIdRef: { current: string | null } = { current: "run-a" };
    let processor: ReturnType<typeof useWsMessageProcessor> | undefined;
    let messageRefreshes = 0;
    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [threadId] = createSignal("thread-a");
      const [spaceId] = createSignal("space-a");
      processor = useWsMessageProcessor({
        threadId,
        spaceRecordId: spaceId,
        currentRunIdRef,
        t: (key) => key,
        fetchMessages: async () => {
          messageRefreshes += 1;
        },
      });
    });
    processor!.setCurrentRun(summary("run-a", "thread-a", "space-a"));
    processor!.setIsLoading(true);

    expect(await processor!.verifyRunStatus("run-a")).toBe(true);
    expect(processor!.currentRun?.id).toBe("run-a");
    expect(processor!.isLoading).toBe(true);
    expect(messageRefreshes).toBe(0);
  } finally {
    dispose?.();
    globalThis.fetch = originalFetch;
  }
});

test("an old transport close check cannot complete the replacement Run", async () => {
  const originalFetch = globalThis.fetch;
  const oldStatus = deferredResponse();
  globalThis.fetch = (() => oldStatus.promise) as unknown as typeof fetch;

  const currentRunIdRef: { current: string | null } = { current: "run-a" };
  const reconnectAttemptsRef = { current: 0 };
  let completed = 0;
  let loadingWrites = 0;
  let currentRunWrites = 0;
  try {
    const check = handleTransportClose("run-a", "test transport", {
      isMountedRef: { current: true },
      currentRunIdRef,
      reconnectAttemptsRef,
      startWebSocketRef: { current: () => {} },
      handleRunCompletedRef: {
        current: async () => {
          completed += 1;
        },
      },
      setIsLoading: (() => {
        loadingWrites += 1;
      }) as Setter<boolean>,
      setCurrentRun: (() => {
        currentRunWrites += 1;
      }) as Setter<ThreadHistoryRunSummary | null>,
      setError: () => {},
      t: (key) => key,
    });
    currentRunIdRef.current = "run-b";
    oldStatus.resolve(Response.json({
      run: rawRun("run-a", "thread-a", "space-a", {
        status: "completed",
        completed_at: "2026-08-10T00:00:03.000Z",
      }),
    }));
    await check;

    expect(completed).toBe(0);
    expect(reconnectAttemptsRef.current).toBe(0);
    expect(loadingWrites).toBe(0);
    expect(currentRunWrites).toBe(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
