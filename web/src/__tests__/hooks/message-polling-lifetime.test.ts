import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { useMessagePolling } from "../../hooks/useMessagePolling.ts";
import type { Message } from "../../types/index.ts";

// The portable runner also covers server-side modules. Run this browser hook
// with Solid's client conditions in its own process, without replacing modules.
if (Bun.env.TAKOS_CHAT_POLLING_TEST_CLIENT !== "1") {
  test("message polling cancellation uses the actual browser hook", async () => {
    const child = Bun.spawn([
      process.execPath,
      "--conditions=browser",
      "test",
      import.meta.path,
    ], {
      env: { ...process.env, TAKOS_CHAT_POLLING_TEST_CLIENT: "1" },
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
  async function withPollingResponse(
    response: () => Response,
    run: (
      polling: ReturnType<typeof useMessagePolling>,
      headersReady: Promise<void>,
    ) => Promise<void>,
  ): Promise<void> {
    let headersReceived!: () => void;
    const headersReady = new Promise<void>((resolve) => {
      headersReceived = resolve;
    });
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        expect(new URL(request.url).pathname).toBe(
          "/api/threads/thread-a/messages",
        );
        return response();
      },
    });
    const originalFetch = globalThis.fetch;
    // Resolve the browser's relative URL to this test's loopback HTTP server.
    // Preserve the real Response body and fetch/AbortSignal behavior.
    globalThis.fetch = (async (input, init) => {
      expect(input).toBe("/api/threads/thread-a/messages");
      const response = await originalFetch(new URL(String(input), server.url), init);
      headersReceived();
      return response;
    }) as typeof fetch;
    let dispose!: () => void;
    const polling = createRoot((cleanup) => {
      dispose = cleanup;
      return useMessagePolling({ threadId: () => "thread-a", t: (key) => key });
    });
    try {
      await run(polling, headersReady);
    } finally {
      polling.isMountedRef.current = false;
      polling.abortPendingFetch();
      polling.stopMessagePolling();
      dispose();
      globalThis.fetch = originalFetch;
      server.stop(true);
    }
  }

  test("sending a message does not display an aborted polling failure", async () => {
    await withPollingResponse(() =>
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"error":'));
        },
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }), async (polling, headersReady) => {
      const pending = polling.fetchMessages(true);
      await headersReady;
      // useChatMessages calls this before starting a new send in the same view.
      polling.abortPendingFetch();
      await pending;
      expect(polling.error).toBeNull();
      expect(polling.messages).toEqual([]);
    });
  });

  test("a retired conversation cannot display a late HTTP failure", async () => {
    let finishBody!: () => void;
    await withPollingResponse(() =>
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"error":'));
          finishBody = () => {
            controller.enqueue(new TextEncoder().encode('"unavailable"}'));
            controller.close();
          };
        },
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }), async (polling, headersReady) => {
      const pending = polling.fetchMessages(true);
      await headersReady;
      polling.isMountedRef.current = false;
      finishBody();
      await pending;
      expect(polling.error).toBeNull();
    });
  });

  test("a current HTTP failure is visible and a successful retry restores messages", async () => {
    let unavailable = true;
    const messages: Message[] = [{
      id: "current-message",
      thread_id: "thread-a",
      role: "assistant",
      content: "Current reply",
      metadata: "{}",
      created_at: "2026-11-06T00:00:00.000Z",
      sequence: 4,
    }];
    await withPollingResponse(() =>
      unavailable
        ? Response.json({ error: "unavailable" }, { status: 503 })
        : Response.json({ messages }), async (polling) => {
      await polling.fetchMessages(true);
      expect(polling.error).toBe("failedToLoadMessages");
      unavailable = false;
      await polling.fetchMessages(true);
      expect(polling.error).toBeNull();
      expect(polling.messages).toEqual(messages);
    });
  });
}
