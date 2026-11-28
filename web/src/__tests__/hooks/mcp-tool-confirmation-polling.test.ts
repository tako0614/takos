import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { setImmediate as realSetImmediate } from "node:timers";
import { createRoot, createSignal } from "solid-js";
import { useMcpToolConfirmations } from "../../hooks/useMcpToolConfirmations.ts";

if (Bun.env.TAKOS_MCP_CONFIRMATION_TEST_CLIENT !== "1") {
  test("MCP confirmation polling uses Solid's actual browser lifecycle", async () => {
    const child = Bun.spawn(
      [process.execPath, "--conditions=browser", "test", import.meta.path],
      {
        env: { ...process.env, TAKOS_MCP_CONFIRMATION_TEST_CLIENT: "1" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (code !== 0) throw new Error(stdout + "\n" + stderr);
    expect(code).toBe(0);
  });
} else {
  const realFetch = globalThis.fetch;
  const disposals: Array<() => void> = [];
  const responses = (id?: string) => Response.json({ data: id ? [{ id }] : [] });
  const settle = () => new Promise<void>((resolve) => realSetImmediate(resolve));
  const advance = async (ms: number) => {
    jest.advanceTimersByTime(ms);
    await settle();
  };

  const mount = (initial: string | null, fetch: typeof globalThis.fetch) => {
    globalThis.fetch = fetch;
    return createRoot((dispose) => {
      disposals.push(dispose);
      const [spaceId, setSpaceId] = createSignal(initial);
      return { ...useMcpToolConfirmations(spaceId), setSpaceId, dispose };
    });
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    disposals.splice(0).forEach((dispose) => dispose());
    jest.clearAllTimers();
    jest.useRealTimers();
    globalThis.fetch = realFetch;
  });

  test("idle and pending intervals preserve refresh; an empty workspace stays quiet", async () => {
    let id: string | undefined;
    const fetch = jest.fn(async (_url: string) => responses(id));
    const hook = mount("space a", fetch as unknown as typeof globalThis.fetch);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe("/api/mcp/tool-confirmations?workspaceId=space%20a");
    await advance(9_999);
    expect(fetch).toHaveBeenCalledTimes(1);

    id = "needs-confirmation";
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(hook.confirmations().map((row) => row.id)).toEqual([id]);
    await advance(1_999);
    expect(fetch).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetch).toHaveBeenCalledTimes(3);

    id = undefined;
    await hook.refresh();
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(hook.confirmations()).toEqual([]);
    hook.setSpaceId(null);
    await advance(30_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a failed poll retries, and an explicit decision still refreshes immediately", async () => {
    const list = "/api/mcp/tool-confirmations?workspaceId=space-a";
    const decision = "/api/mcp/tool-confirmations/pending/decision?workspaceId=space-a";
    let attempt = 0;
    const fetch = jest.fn(async (url: string, init?: RequestInit) => {
      if (url === decision) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ decision: "approve" }));
        return new Response(null, { status: 204 });
      }
      attempt++;
      if (attempt === 1) throw new Error("fixture network error");
      return responses(attempt === 2 ? "pending" : undefined);
    });
    const hook = mount("space-a", fetch as unknown as typeof globalThis.fetch);
    await settle();
    await advance(10_000);
    expect(hook.confirmations().map((row) => row.id)).toEqual(["pending"]);
    await hook.decide("pending", "approve");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([list, list, decision, list]);
    expect(hook.confirmations()).toEqual([]);
    expect(hook.error()).toBeNull();
  });

  test("a late initial response cannot resurrect polling after dispose and remount", async () => {
    let finish!: (value: Response) => void;
    const held = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = jest.fn(async (_url: string) =>
      fetch.mock.calls.length === 1 ? held : responses("current"),
    );
    const retired = mount("same", fetch as unknown as typeof globalThis.fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    retired.dispose();
    const current = mount("same", fetch as unknown as typeof globalThis.fetch);
    await settle();
    current.dispose();
    finish(responses("retired"));
    await settle();
    expect(retired.confirmations()).toEqual([]);
    expect(current.confirmations().map((row) => row.id)).toEqual(["current"]);
    expect(jest.getTimerCount()).toBe(0);
    await advance(30_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("a late poll for the previous workspace cannot change the current workspace timer", async () => {
    let finish!: (value: Response) => void;
    const held = new Promise<Response>((resolve) => { finish = resolve; });
    const fetch = jest.fn(async (url: string): Promise<Response> => {
      if (fetch.mock.calls.length === 2) return held;
      return responses(url.endsWith("space-b") ? "current" : "previous");
    });
    const hook = mount("space-a", fetch as unknown as typeof globalThis.fetch);
    await settle();
    await advance(2_000);
    expect(fetch).toHaveBeenCalledTimes(2);

    hook.setSpaceId("space-b");
    await settle();
    expect(fetch).toHaveBeenCalledTimes(3);
    await advance(1_000);
    finish(responses("retired"));
    await settle();
    expect(hook.confirmations().map((row) => row.id)).toEqual(["current"]);
    await advance(1_000);
    expect(fetch.mock.calls.map(([url]) => new URL(url, "https://fixture.invalid").search)).toEqual([
      "?workspaceId=space-a", "?workspaceId=space-a", "?workspaceId=space-b", "?workspaceId=space-b",
    ]);
  });
}
