import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  LOCAL_AGENT_PROOF_ASSISTANT_MARKER,
  runAuthenticatedStagingFunctionalProof,
  runLocalAgentPublicApiProof,
  type AuthenticatedOwnerSessionRequest,
  type AuthenticatedOwnerSessionTransport,
} from "../local-agent-proof.ts";
import {
  createAuthenticatedOwnerSessionFileTransport,
  parseFirstInstallFunctionalProofArgs,
  runFirstInstallFunctionalProofOwnerOperation,
} from "../first-install-functional-proof.ts";

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

function authenticatedStagingTransport(options?: {
  model?: string;
  executorContainerId?: string | null;
  receiptServiceId?: string;
  receiptAvailableAfterPoll?: number;
  cleanupStatus?: number;
}): AuthenticatedOwnerSessionTransport & {
  requests: AuthenticatedOwnerSessionRequest[];
} {
  const requests: AuthenticatedOwnerSessionRequest[] = [];
  let runPolls = 0;
  return {
    kind: "takos.authenticated-owner-session-transport@v1",
    requests,
    async request(request) {
      requests.push(request);
      const { method, path, scope } = request;
      if (scope === "anonymous" && path === "/health") {
        return { status: 200, body: { status: "ok" } };
      }
      if (scope === "anonymous" && path === "/api/auth/me") {
        return { status: 401, body: { error: "unauthorized" } };
      }
      if (scope === "owner" && method === "GET" && path === "/api/auth/me") {
        return {
          status: 200,
          body: {
            user: { auth_identities: [{ source: "oidc", email: "owner@test" }] },
          },
        };
      }
      if (scope === "owner" && method === "GET" && path === "/api/setup/status") {
        return { status: 200, body: { setup_completed: true } };
      }
      if (scope === "owner" && method === "POST" && path === "/api/spaces") {
        return { status: 201, body: { space: { id: "space-functional" } } };
      }
      if (scope === "owner" && method === "GET" && path === "/api/spaces") {
        return { status: 200, body: { spaces: [{ id: "space-functional" }] } };
      }
      if (method === "POST" && path === "/api/spaces/space-functional/threads") {
        return { status: 201, body: { thread: { id: "thread-functional" } } };
      }
      if (method === "POST" && path === "/api/threads/thread-functional/messages") {
        return { status: 201, body: { message: { id: "message-functional" } } };
      }
      if (method === "POST" && path === "/api/threads/thread-functional/runs") {
        return {
          status: 201,
          body: {
            run: {
              id: "run-functional",
              status: "queued",
              model: options?.model ?? "managed:owner-model",
            },
          },
        };
      }
      if (method === "GET" && path === "/api/runs/run-functional") {
        runPolls += 1;
        return {
          status: 200,
          body: {
            run: {
              id: "run-functional",
              model: options?.model ?? "managed:owner-model",
              status: runPolls === 1 ? "running" : "completed",
              output: runPolls === 1 ? null : "A real nonempty assistant answer",
              worker_id: "service-functional",
            },
          },
        };
      }
      if (method === "GET" && path === "/api/runs/run-functional/events") {
        const id = options?.executorContainerId === undefined
          ? "01JREALCONTAINER1234567890"
          : options.executorContainerId;
        return {
          status: 200,
          body: {
            events: [
              ...(runPolls >= (options?.receiptAvailableAfterPoll ?? 0)
                ? [{
                    type: "executor_dispatch_receipt",
                    data: JSON.stringify({
                      service_id: options?.receiptServiceId ?? "service-functional",
                      lease_version: 1,
                      recorded_at: "2026-09-04T00:00:00.000Z",
                      ...(id === null ? {} : { executor_container_id: id }),
                    }),
                  }]
                : []),
              { type: "started", data: "{}" },
              ...(runPolls > 1 ? [{ type: "completed", data: "{}" }] : []),
            ],
          },
        };
      }
      if (method === "GET" && path === "/api/threads/thread-functional/messages") {
        return {
          status: 200,
          body: {
            messages: runPolls > 1
              ? [{ role: "assistant", content: "A real nonempty assistant answer" }]
              : [],
          },
        };
      }
      if (method === "DELETE" && path === "/api/spaces/space-functional") {
        return {
          status: options?.cleanupStatus ?? 200,
          body: { success: options?.cleanupStatus === undefined },
        };
      }
      return { status: 404, body: { error: `unexpected ${method} ${path}` } };
    },
  };
}

describe("authenticated staging functional proof", () => {
  test("proves OIDC, setup, workspace/chat, a real container run, and cleanup without accepting raw auth", async () => {
    const transport = authenticatedStagingTransport();
    const proof = await runAuthenticatedStagingFunctionalProof({
      transport,
      sourceCommit: "1".repeat(40),
      servedVersion: "11111111-2222-3333-4444-555555555555",
      publicUrl: "https://app.example.test",
      sleep: async () => {},
      now: () => 1_000,
    });

    expect(proof).toMatchObject({
      kind: "takos.first-install-functional-proof@v1",
      status: "passed",
      sourceCommit: "1".repeat(40),
      publicUrl: "https://app.example.test",
      servedVersion: "11111111-2222-3333-4444-555555555555",
      oidcIdentityObserved: true,
      setupCompleted: true,
      workspaceId: "space-functional",
      threadId: "thread-functional",
      runId: "run-functional",
      runStatus: "completed",
      model: "managed:owner-model",
      executorContainerId: "01JREALCONTAINER1234567890",
      assistantOutputDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      cleanup: { workspace: "deleted" },
    });
    expect(Object.keys(proof).sort()).toEqual([
      "assistantOutputDigest",
      "checkedAt",
      "checks",
      "cleanup",
      "executorContainerId",
      "executorReceipt",
      "kind",
      "model",
      "oidcIdentityObserved",
      "pollCount",
      "publicUrl",
      "runId",
      "runStatus",
      "servedVersion",
      "setupCompleted",
      "sourceCommit",
      "status",
      "threadId",
      "workspaceId",
    ]);
    expect(Object.keys(proof.executorReceipt).sort()).toEqual([
      "leaseVersion",
      "recordedAt",
      "serviceId",
    ]);
    expect(Object.keys(proof.cleanup).sort()).toEqual(["workspace"]);
    for (const check of proof.checks) {
      expect(Object.keys(check).sort()).toEqual([
        "bodyDigest",
        "name",
        "status",
      ]);
    }
    expect(proof.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "health", status: 200 }),
        expect.objectContaining({ name: "auth-boundary", status: 401 }),
        expect.objectContaining({ name: "oidc-owner", status: 200 }),
        expect.objectContaining({ name: "setup", status: 200 }),
        expect.objectContaining({ name: "agent-run", status: 200 }),
        expect.objectContaining({ name: "cleanup", status: 200 }),
      ]),
    );
    const runCreate = transport.requests.find(
      (request) => request.path === "/api/threads/thread-functional/runs",
    );
    expect(runCreate?.body).toEqual({
      agent_type: "default",
      input: { proof: "takos-first-install-functional" },
    });
    expect("model" in (runCreate?.body ?? {})).toBe(false);
    expect(JSON.stringify(proof)).not.toContain("A real nonempty assistant answer");
  });

  test("refuses local-smoke and missing real executor evidence but still deletes the proof workspace", async () => {
    for (const transport of [
      authenticatedStagingTransport({ model: "local-smoke" }),
      authenticatedStagingTransport({ executorContainerId: null }),
      authenticatedStagingTransport({ receiptServiceId: "stale-service" }),
    ]) {
      let tick = 0;
      await expect(
        runAuthenticatedStagingFunctionalProof({
          transport,
          sourceCommit: "1".repeat(40),
          servedVersion: "11111111-2222-3333-4444-555555555555",
          publicUrl: "https://app.example.test",
          sleep: async () => {},
          now: () => 1_000 + tick++,
          timeoutMs: 8,
          pollIntervalMs: 0,
        }),
      ).rejects.toThrow(/local-smoke|executor_container_id/u);
      expect(
        transport.requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.path === "/api/spaces/space-functional",
        ),
      ).toBe(true);
    }
  });

  test("waits for terminal receipt evidence that follows a fast completed run", async () => {
    const transport = authenticatedStagingTransport({
      receiptAvailableAfterPoll: 3,
    });
    const proof = await runAuthenticatedStagingFunctionalProof({
      transport,
      sourceCommit: "1".repeat(40),
      servedVersion: "11111111-2222-3333-4444-555555555555",
      publicUrl: "https://app.example.test",
      sleep: async () => {},
      now: () => 1_000,
      pollIntervalMs: 0,
    });

    expect(proof.status).toBe("passed");
    expect(
      transport.requests.filter(
        (request) => request.path === "/api/runs/run-functional",
      ),
    ).toHaveLength(3);
    expect(proof.executorReceipt.serviceId).toBe("service-functional");
  });

  test("does not report a passing proof when cleanup is not authoritatively acknowledged", async () => {
    const transport = authenticatedStagingTransport({ cleanupStatus: 503 });
    await expect(
      runAuthenticatedStagingFunctionalProof({
        transport,
        sourceCommit: "1".repeat(40),
        servedVersion: "11111111-2222-3333-4444-555555555555",
        publicUrl: "https://app.example.test",
        sleep: async () => {},
        now: () => 1_000,
      }),
    ).rejects.toThrow(/cleanup/u);
  });

  test("owner operation preserves refused, indeterminate, and post-condition exit classes", async () => {
    const proofOptions = {
      sourceCommit: "1".repeat(40),
      servedVersion: "11111111-2222-3333-4444-555555555555",
      publicUrl: "https://app.example.test",
      sleep: async () => {},
      now: () => 1_000,
    } as const;

    const refusedBase = authenticatedStagingTransport();
    const refusedTransport: AuthenticatedOwnerSessionTransport = {
      kind: "takos.authenticated-owner-session-transport@v1",
      request: async (request) =>
        request.path === "/health"
          ? { status: 503, body: { status: "unavailable" } }
          : refusedBase.request(request),
    };
    await expect(
      runFirstInstallFunctionalProofOwnerOperation({
        ...proofOptions,
        transport: refusedTransport,
      }),
    ).rejects.toMatchObject({ stage: "refused", exitCode: 2 });

    await expect(
      runFirstInstallFunctionalProofOwnerOperation({
        ...proofOptions,
        transport: authenticatedStagingTransport({ model: "local-smoke" }),
      }),
    ).rejects.toMatchObject({ stage: "post-conditions", exitCode: 4 });

    await expect(
      runFirstInstallFunctionalProofOwnerOperation({
        ...proofOptions,
        transport: authenticatedStagingTransport({ cleanupStatus: 503 }),
      }),
    ).rejects.toMatchObject({ stage: "indeterminate", exitCode: 3 });

    const lostAckBase = authenticatedStagingTransport();
    const lostAckTransport: AuthenticatedOwnerSessionTransport = {
      kind: "takos.authenticated-owner-session-transport@v1",
      request: async (request) => {
        if (
          request.method === "POST" &&
          request.path === "/api/threads/thread-functional/runs"
        ) {
          throw new Error("run create acknowledgement was lost");
        }
        return await lostAckBase.request(request);
      },
    };
    await expect(
      runFirstInstallFunctionalProofOwnerOperation({
        ...proofOptions,
        transport: lostAckTransport,
      }),
    ).rejects.toMatchObject({ stage: "indeterminate", exitCode: 3 });
    expect(
      lostAckBase.requests.some(
        (request) =>
          request.method === "DELETE" &&
          request.path === "/api/spaces/space-functional",
      ),
    ).toBe(true);

    const lostWorkspaceIdentityBase = authenticatedStagingTransport();
    const lostWorkspaceIdentityTransport: AuthenticatedOwnerSessionTransport = {
      kind: "takos.authenticated-owner-session-transport@v1",
      request: async (request) =>
        request.method === "POST" && request.path === "/api/spaces"
          ? { status: 201, body: { space: {} } }
          : await lostWorkspaceIdentityBase.request(request),
    };
    await expect(
      runFirstInstallFunctionalProofOwnerOperation({
        ...proofOptions,
        transport: lostWorkspaceIdentityTransport,
      }),
    ).rejects.toMatchObject({ stage: "indeterminate", exitCode: 3 });
  });
});

describe("authenticated owner session file adapter", () => {
  test("keeps auth out of argv/transport input, omits it for anonymous checks, and follows session rotation", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-owner-session-"));
    const sessionFile = join(root, "session");
    await chmod(root, 0o700);
    await writeFile(sessionFile, "A2345678901234567890_session\n", { mode: 0o600 });
    const observed: Array<{ path: string; cookie: string | null; origin: string | null }> = [];
    const pinned: string[] = [];
    let resolutions = 0;
    try {
      const transport = await createAuthenticatedOwnerSessionFileTransport({
        publicUrl: "https://app.example.test",
        ownerSessionFile: sessionFile,
        repositoryRoot: resolve(import.meta.dir, "../.."),
        resolveAddresses: async (hostname) => {
          resolutions += 1;
          expect(hostname).toBe("app.example.test");
          return [{ address: "93.184.216.34", family: 4 }];
        },
        pinnedFetchImpl: async (input, init, address) => {
          pinned.push(`${address.address}/${address.family}`);
          const request = new Request(input, init);
          observed.push({
            path: new URL(request.url).pathname,
            cookie: request.headers.get("cookie"),
            origin: request.headers.get("origin"),
          });
          return Response.json(
            { ok: true },
            observed.length === 2
              ? {
                  headers: {
                    "Set-Cookie":
                      "__Host-tp_session=B2345678901234567890_rotated; Path=/; Secure; HttpOnly",
                  },
                }
              : undefined,
          );
        },
      });
      await transport.request({ scope: "anonymous", method: "GET", path: "/health" });
      await transport.request({ scope: "owner", method: "GET", path: "/api/auth/me" });
      await transport.request({ scope: "owner", method: "GET", path: "/api/setup/status" });
      expect(observed).toEqual([
        { path: "/health", cookie: null, origin: null },
        {
          path: "/api/auth/me",
          cookie: "__Host-tp_session=A2345678901234567890_session",
          origin: "https://app.example.test",
        },
        {
          path: "/api/setup/status",
          cookie: "__Host-tp_session=B2345678901234567890_rotated",
          origin: "https://app.example.test",
        },
      ]);
      expect(resolutions).toBe(1);
      expect(pinned).toEqual([
        "93.184.216.34/4",
        "93.184.216.34/4",
        "93.184.216.34/4",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects permissive and symlinked session custody before fetch", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-owner-session-invalid-"));
    const real = join(root, "real-session");
    const linked = join(root, "linked-session");
    await chmod(root, 0o700);
    await writeFile(real, "A2345678901234567890_session\n", { mode: 0o644 });
    const pinnedFetchImpl = (() => {
      throw new Error("fetch must not run");
    }) as never;
    const resolveAddresses = async () => [
      { address: "93.184.216.34", family: 4 as const },
    ];
    try {
      await expect(
        createAuthenticatedOwnerSessionFileTransport({
          publicUrl: "https://app.example.test",
          ownerSessionFile: real,
          repositoryRoot: resolve(import.meta.dir, "../.."),
          resolveAddresses,
          pinnedFetchImpl,
        }),
      ).rejects.toThrow(/0600/u);
      await chmod(real, 0o600);
      await symlink(real, linked);
      await expect(
        createAuthenticatedOwnerSessionFileTransport({
          publicUrl: "https://app.example.test",
          ownerSessionFile: linked,
          repositoryRoot: resolve(import.meta.dir, "../.."),
          resolveAddresses,
          pinnedFetchImpl,
        }),
      ).rejects.toThrow(/canonical|symbolic link/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects private or mixed DNS before reading or sending the owner session", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-owner-session-dns-"));
    let requests = 0;
    const pinnedFetchImpl = async () => {
      requests += 1;
      return Response.json({ ok: true });
    };
    try {
      for (const answers of [
        [{ address: "10.0.0.7", family: 4 as const }],
        [
          { address: "93.184.216.34", family: 4 as const },
          { address: "127.0.0.1", family: 4 as const },
        ],
        [{ address: "fd00::7", family: 6 as const }],
      ]) {
        await expect(
          createAuthenticatedOwnerSessionFileTransport({
            publicUrl: "https://app.example.test",
            ownerSessionFile: join(root, "does-not-exist"),
            repositoryRoot: resolve(import.meta.dir, "../.."),
            resolveAddresses: async () => answers,
            pinnedFetchImpl,
          }),
        ).rejects.toThrow(/globally routable DNS answers/u);
      }
      expect(requests).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("pins one safe address across requests even when a resolver would alternate", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-owner-session-pin-"));
    const sessionFile = join(root, "session");
    await chmod(root, 0o700);
    await writeFile(sessionFile, "A2345678901234567890_session\n", { mode: 0o600 });
    let resolutions = 0;
    const used: string[] = [];
    try {
      const transport = await createAuthenticatedOwnerSessionFileTransport({
        publicUrl: "https://app.example.test",
        ownerSessionFile: sessionFile,
        repositoryRoot: resolve(import.meta.dir, "../.."),
        resolveAddresses: async () => {
          resolutions += 1;
          return resolutions === 1
            ? [{ address: "93.184.216.34", family: 4 }]
            : [{ address: "127.0.0.1", family: 4 }];
        },
        pinnedFetchImpl: async (_input, _init, address) => {
          used.push(address.address);
          return Response.json({ ok: true });
        },
      });
      await transport.request({ scope: "anonymous", method: "GET", path: "/health" });
      await transport.request({ scope: "owner", method: "GET", path: "/api/auth/me" });
      expect(resolutions).toBe(1);
      expect(used).toEqual(["93.184.216.34", "93.184.216.34"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses redirects and path-based origin confusion without following either", async () => {
    const root = await mkdtemp(join(tmpdir(), "takos-owner-session-redirect-"));
    const sessionFile = join(root, "session");
    await chmod(root, 0o700);
    await writeFile(sessionFile, "A2345678901234567890_session\n", { mode: 0o600 });
    let requests = 0;
    try {
      const transport = await createAuthenticatedOwnerSessionFileTransport({
        publicUrl: "https://app.example.test",
        ownerSessionFile: sessionFile,
        repositoryRoot: resolve(import.meta.dir, "../.."),
        resolveAddresses: async () => [
          { address: "93.184.216.34", family: 4 },
        ],
        pinnedFetchImpl: async () => {
          requests += 1;
          return new Response(null, {
            status: 302,
            headers: { Location: "https://127.0.0.1/steal" },
          });
        },
      });
      await expect(
        transport.request({
          scope: "owner",
          method: "GET",
          path: "/api/auth/me",
        }),
      ).rejects.toThrow(/refused an HTTP redirect/u);
      expect(requests).toBe(1);
      await expect(
        transport.request({
          scope: "owner",
          method: "GET",
          path: "/\\attacker.example/steal",
        }),
      ).rejects.toThrow(/non-canonical request/u);
      expect(requests).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("CLI accepts only the fixed integration session-file contract", () => {
    expect(
      parseFirstInstallFunctionalProofArgs([
        "--environment",
        "integration",
        "--public-url",
        "https://app.example.test",
        "--source-commit",
        "1".repeat(40),
        "--served-version",
        "11111111-2222-3333-4444-555555555555",
        "--owner-session-file",
        "/private/session",
      ]),
    ).toMatchObject({
      environment: "integration",
      ownerSessionFile: "/private/session",
    });
    expect(() =>
      parseFirstInstallFunctionalProofArgs([
        "--environment",
        "integration",
        "--public-url",
        "https://app.example.test",
        "--source-commit",
        "1".repeat(40),
        "--served-version",
        "11111111-2222-3333-4444-555555555555",
        "--owner-session-file",
        "/private/session",
        "--bearer-token",
        "shared-key-downgrade",
      ]),
    ).toThrow(/unknown argument/u);
  });
});
