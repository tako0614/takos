import { describe, expect, test } from "bun:test";
import {
  LOCAL_AGENT_PROOF_ASSISTANT_MARKER,
  runLocalAgentPublicApiProof,
} from "../local-agent-proof.ts";

describe("local agent public API proof", () => {
  test("stops before public API work when orchestration is interrupted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("proof interrupted"));
    const fetchImpl = (() => {
      throw new Error("fetch must not run");
    }) as typeof fetch;

    await expect(
      runLocalAgentPublicApiProof({
        workerBaseUrl: "http://worker.test",
        proofRuntimeBaseUrl: "http://proof.test",
        proofSecret: "proof-secret",
        fetchImpl,
        signal: controller.signal,
      }),
    ).rejects.toThrow("proof interrupted");
  });

  test("aborts an in-flight public API request on orchestration signal", async () => {
    const controller = new AbortController();
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("missing request signal"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("request aborted")),
          { once: true },
        );
      })) as typeof fetch;

    const proof = runLocalAgentPublicApiProof({
      workerBaseUrl: "http://worker.test",
      proofRuntimeBaseUrl: "http://proof.test",
      proofSecret: "proof-secret",
      fetchImpl,
      signal: controller.signal,
    });
    controller.abort(new Error("proof interrupted in flight"));

    await expect(proof).rejects.toThrow("proof interrupted in flight");
  });

  test("creates thread and run through /api then requires terminal message and events", async () => {
    let runPolls = 0;
    const requests: Array<{ method: string; pathname: string }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      requests.push({ method: request.method, pathname: url.pathname });

      if (url.pathname === "/__proof/bootstrap") {
        expect(request.headers.get("authorization")).toBe(
          "Bearer proof-secret",
        );
        return Response.json({ accessToken: "proof-access-token" });
      }
      expect(request.headers.get("authorization")).toBe(
        "Bearer proof-access-token",
      );
      if (request.method === "POST" && url.pathname === "/api/spaces") {
        return Response.json({ space: { id: "space-proof" } }, { status: 201 });
      }
      if (request.method === "GET" && url.pathname === "/api/spaces") {
        return Response.json({ spaces: [{ id: "space-proof" }] });
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/spaces/space-proof/threads"
      ) {
        return Response.json(
          { thread: { id: "thread-proof" } },
          { status: 201 },
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/threads/thread-proof/messages"
      ) {
        return Response.json(
          { message: { id: "message-user" } },
          { status: 201 },
        );
      }
      if (
        request.method === "POST" &&
        url.pathname === "/api/threads/thread-proof/runs"
      ) {
        return Response.json(
          { run: { id: "run-proof", status: "queued" } },
          { status: 201 },
        );
      }
      if (url.pathname === "/api/runs/run-proof") {
        runPolls += 1;
        return Response.json({
          run: {
            id: "run-proof",
            status: runPolls === 1 ? "running" : "completed",
            output: runPolls === 1 ? null : LOCAL_AGENT_PROOF_ASSISTANT_MARKER,
          },
        });
      }
      if (url.pathname === "/api/runs/run-proof/events") {
        return Response.json({
          events:
            runPolls === 1
              ? [{ type: "started" }]
              : [{ type: "started" }, { type: "completed" }],
          run_status: runPolls === 1 ? "running" : "completed",
        });
      }
      if (url.pathname === "/api/threads/thread-proof/messages") {
        return Response.json({
          messages:
            runPolls === 1
              ? [{ role: "user", content: "proof request" }]
              : [
                  { role: "user", content: "proof request" },
                  {
                    role: "assistant",
                    content: LOCAL_AGENT_PROOF_ASSISTANT_MARKER,
                  },
                ],
        });
      }
      return Response.json({ error: "unexpected request" }, { status: 404 });
    }) as typeof fetch;

    const proof = await runLocalAgentPublicApiProof({
      workerBaseUrl: "http://worker.test",
      proofRuntimeBaseUrl: "http://proof.test",
      proofSecret: "proof-secret",
      fetchImpl,
      sleep: async () => {},
      now: () => 1_000,
    });

    expect(proof).toMatchObject({
      kind: "takos.local-agent-run-proof@v1",
      spaceId: "space-proof",
      threadId: "thread-proof",
      runId: "run-proof",
      status: "completed",
      workspaceListObserved: true,
      runOutputObserved: true,
      assistantMessageObserved: true,
      terminalEventObserved: true,
      pollCount: 2,
    });
    expect(proof.observedStatuses).toEqual(["queued", "running", "completed"]);
    expect(proof.eventTypes).toEqual(["started", "completed"]);
    expect(requests).toContainEqual({
      method: "POST",
      pathname: "/api/threads/thread-proof/runs",
    });
  });

  test("surfaces a failed container run as failed proof evidence", async () => {
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/__proof/bootstrap") {
        return Response.json({ accessToken: "proof-access-token" });
      }
      if (path === "/api/spaces") {
        if (request.method === "GET") {
          return Response.json({ spaces: [{ id: "space-proof" }] });
        }
        return Response.json({ space: { id: "space-proof" } }, { status: 201 });
      }
      if (path === "/api/spaces/space-proof/threads") {
        return Response.json(
          { thread: { id: "thread-proof" } },
          { status: 201 },
        );
      }
      if (request.method === "POST" && path.endsWith("/messages")) {
        return Response.json(
          { message: { id: "message-user" } },
          { status: 201 },
        );
      }
      if (request.method === "POST" && path.endsWith("/runs")) {
        return Response.json(
          { run: { id: "run-proof", status: "queued" } },
          { status: 201 },
        );
      }
      if (path === "/api/runs/run-proof") {
        return Response.json({
          run: { id: "run-proof", status: "failed", error: "container failed" },
        });
      }
      if (path === "/api/runs/run-proof/events") {
        return Response.json({
          events: [{ type: "error" }],
          run_status: "failed",
        });
      }
      if (path === "/api/threads/thread-proof/messages") {
        return Response.json({ messages: [] });
      }
      return Response.json({ error: "unexpected request" }, { status: 404 });
    }) as typeof fetch;

    await expect(
      runLocalAgentPublicApiProof({
        workerBaseUrl: "http://worker.test",
        proofRuntimeBaseUrl: "http://proof.test",
        proofSecret: "proof-secret",
        fetchImpl,
        sleep: async () => {},
        now: () => 1_000,
      }),
    ).rejects.toThrow(
      "agent run reached terminal status failed: container failed",
    );
  });
});
