import { test } from "bun:test";
/**
 * End-to-end signal forwarding test for the workers-dispatch deploy path.
 *
 * Verifies that aborting the caller's signal mid-deploy reaches the
 * underlying `globalThis.fetch` request: the request's `signal.aborted`
 * flag flips to `true`, and the in-flight fetch rejects with `AbortError`.
 * This guards the wave-18c regression where {@link WFPService} methods
 * accepted no signal and the abort was confined to the awaiting Promise
 * while the Cloudflare HTTP request kept running until the 10-minute
 * client-side timeout fired.
 */

import { assertEquals, assertRejects } from "@std/assert";

import { WfpClient } from "../client.ts";
import { WFPService } from "../service.ts";
import { createWorkersDispatchDeploymentBackend } from "../../deployment/backend.ts";
import type { Deployment } from "../../deployment/models.ts";

type FetchCall = {
  url: string;
  init: RequestInit;
  signal: AbortSignal | null;
};

function installRecordingFetch(): {
  calls: FetchCall[];
  pending: Array<{
    abortedReasonPromise: Promise<unknown>;
    abortedReasonResolve: (reason: unknown) => void;
  }>;
  restore: () => void;
} {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  const pending: Array<{
    abortedReasonPromise: Promise<unknown>;
    abortedReasonResolve: (reason: unknown) => void;
  }> = [];

  globalThis.fetch = function recordingFetch(
    input: string | URL | Request,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = input instanceof Request
      ? input.url
      : input instanceof URL
      ? input.toString()
      : input;
    const signal = (init.signal ?? null) as AbortSignal | null;
    calls.push({ url, init, signal });
    return new Promise<Response>((_resolve, reject) => {
      let resolveAborted!: (reason: unknown) => void;
      const abortedReasonPromise = new Promise<unknown>((res) => {
        resolveAborted = res;
      });
      pending.push({
        abortedReasonPromise,
        abortedReasonResolve: resolveAborted,
      });
      if (!signal) return;
      const onAbort = () => {
        const reason = signal.reason ??
          new DOMException("aborted", "AbortError");
        resolveAborted(reason);
        const err = reason instanceof Error ? reason : new DOMException(
          typeof reason === "string" ? reason : "aborted",
          "AbortError",
        );
        // Native fetch always rejects with AbortError on signal abort,
        // independent of the abort reason kind. Match that contract so the
        // WfpClient catch-branch hits its AbortError path.
        const abortErr = err.name === "AbortError"
          ? err
          : Object.assign(new Error(err.message), { name: "AbortError" });
        reject(abortErr);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  } as typeof globalThis.fetch;

  return {
    calls,
    pending,
    restore() {
      globalThis.fetch = original;
    },
  };
}

function createTrackedAbortController(): {
  controller: AbortController;
  listenerCount: () => number;
} {
  const controller = new AbortController();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  let count = 0;

  signal.addEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (!listener) return;
    if (type === "abort") count++;
    return add(type, listener, options);
  }) as AbortSignal["addEventListener"];
  signal.removeEventListener = ((
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ) => {
    if (!listener) return;
    if (type === "abort") count--;
    return remove(type, listener, options);
  }) as AbortSignal["removeEventListener"];

  return { controller, listenerCount: () => count };
}

test(
  "WFPService.workers.createWorker aborts the underlying Cloudflare fetch mid-call",
  async () => {
    const harness = installRecordingFetch();
    try {
      const wfp = new WFPService({
        accountId: "acct-e2e",
        apiToken: "token-e2e",
        dispatchNamespace: "ns-e2e",
      });
      const controller = new AbortController();

      const pending = wfp.workers.createWorker({
        workerName: "worker-e2e",
        workerScript: "export default {}",
        bindings: [],
        signal: controller.signal,
      });

      // Wait one microtask flush so the fetch call has registered before we
      // abort. The test cares that the abort lands *after* the request was
      // dispatched, not before.
      await Promise.resolve();
      await Promise.resolve();
      assertEquals(harness.calls.length, 1, "expected fetch to be dispatched");
      const firstCall = harness.calls[0]!;
      assertEquals(
        firstCall.signal !== null,
        true,
        "WfpClient.fetch must forward an AbortSignal to globalThis.fetch",
      );
      assertEquals(
        firstCall.signal!.aborted,
        false,
        "signal should not be aborted before controller.abort()",
      );

      controller.abort(new Error("deploy-cancelled-e2e"));
      assertEquals(
        firstCall.signal!.aborted,
        true,
        "underlying fetch request signal must observe the caller abort immediately",
      );

      await assertRejects(
        async () => await pending,
        Error,
        "deploy-cancelled-e2e",
      );

      assertEquals(
        firstCall.signal!.aborted,
        true,
        "underlying fetch request signal must observe the caller abort",
      );
    } finally {
      harness.restore();
    }
  },
);

test(
  "workers-dispatch backend forwards signal into the Cloudflare HTTP fetch",
  async () => {
    const harness = installRecordingFetch();
    try {
      const wfp = new WFPService({
        accountId: "acct-e2e",
        apiToken: "token-e2e",
        dispatchNamespace: "ns-e2e",
      });
      const backend = createWorkersDispatchDeploymentBackend(wfp);
      const controller = new AbortController();

      const pending = backend.deploy({
        deployment: {
          id: "dep-e2e",
          space_id: "space-e2e",
          target_json: "{}",
        } as Deployment,
        artifactRef: "worker-e2e",
        bundleContent: "export default {}",
        wasmContent: null,
        runtime: { profile: "workers", bindings: [] },
        signal: controller.signal,
      });

      await Promise.resolve();
      await Promise.resolve();
      assertEquals(
        harness.calls.length,
        1,
        "expected the workers-dispatch backend to dispatch a fetch",
      );
      const firstCall = harness.calls[0]!;
      assertEquals(
        firstCall.signal !== null,
        true,
        "deploy() must forward an AbortSignal down to globalThis.fetch",
      );

      controller.abort(new Error("workers-dispatch-cancelled-e2e"));
      assertEquals(
        firstCall.signal!.aborted,
        true,
        "Cloudflare HTTP fetch request.signal.aborted must flip immediately after abort",
      );

      await assertRejects(
        async () => await pending,
        Error,
        "workers-dispatch-cancelled-e2e",
      );

      assertEquals(
        firstCall.signal!.aborted,
        true,
        "Cloudflare HTTP fetch request.signal.aborted must be true after mid-deploy abort",
      );
    } finally {
      harness.restore();
    }
  },
);

test("WfpClient.fetch removes parent-signal listener after success", async () => {
  const original = globalThis.fetch;
  const tracked = createTrackedAbortController();
  try {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            errors: [],
            messages: [],
            result: { ok: true },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      )) as typeof globalThis.fetch;

    const client = new WfpClient({
      accountId: "acct-e2e",
      apiToken: "token-e2e",
      dispatchNamespace: "ns-e2e",
    });

    await client.fetch("/accounts/acct-e2e/test", {}, {
      signal: tracked.controller.signal,
    });

    assertEquals(
      tracked.listenerCount(),
      0,
      "successful fetch must detach the per-call listener from the parent signal",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("WFPService retry delay stops promptly when the caller signal aborts", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 10000, message: "rate limited" }],
            messages: [],
            result: null,
          }),
          {
            status: 429,
            statusText: "Too Many Requests",
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "60",
            },
          },
        ),
      )) as typeof globalThis.fetch;

    const wfp = new WFPService({
      accountId: "acct-e2e",
      apiToken: "token-e2e",
      dispatchNamespace: "ns-e2e",
    });
    const controller = new AbortController();
    const pending = wfp.workers.createWorker({
      workerName: "worker-retry-e2e",
      workerScript: "export default {}",
      bindings: [],
      signal: controller.signal,
    });

    setTimeout(() => {
      controller.abort(new Error("retry-delay-cancelled"));
    }, 5);

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => resolve("timeout"), 250);
    });
    const result = await Promise.race([
      pending.then(
        () => "resolved" as const,
        (error) => error,
      ),
      timeout,
    ]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);

    assertEquals(
      result === "timeout",
      false,
      "caller abort must interrupt retry backoff instead of waiting for Retry-After",
    );
    assertEquals(result instanceof Error, true);
    assertEquals((result as Error).message, "retry-delay-cancelled");
  } finally {
    globalThis.fetch = original;
  }
});
