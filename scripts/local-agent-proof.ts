import { createHash } from "node:crypto";

export const LOCAL_AGENT_PROOF_ASSISTANT_MARKER =
  "local-agent-proof: queue -> agent container -> terminal";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

type JsonRecord = Record<string, unknown>;

export type AuthenticatedOwnerSessionRequest = Readonly<{
  scope: "anonymous" | "owner";
  method: "GET" | "POST" | "DELETE";
  path: string;
  body?: Readonly<Record<string, unknown>>;
}>;

export type AuthenticatedOwnerSessionResponse = Readonly<{
  status: number;
  body: unknown;
}>;

/**
 * Capability object supplied by an adapter that already owns an authenticated
 * browser session. The proof core deliberately accepts no cookie, bearer, API
 * key, or MFA material, so callers cannot downgrade it into shared-key auth.
 */
export type AuthenticatedOwnerSessionTransport = Readonly<{
  kind: "takos.authenticated-owner-session-transport@v1";
  request: (
    request: AuthenticatedOwnerSessionRequest,
  ) => Promise<AuthenticatedOwnerSessionResponse>;
}>;

export type FirstInstallFunctionalCheck = Readonly<{
  name:
    | "health"
    | "auth-boundary"
    | "oidc-owner"
    | "setup"
    | "workspace"
    | "chat"
    | "agent-run"
    | "cleanup";
  status: number;
  bodyDigest: string;
}>;

export type FirstInstallFunctionalProof = Readonly<{
  kind: "takos.first-install-functional-proof@v1";
  status: "passed";
  sourceCommit: string;
  publicUrl: string;
  servedVersion: string;
  checkedAt: string;
  checks: readonly FirstInstallFunctionalCheck[];
  oidcIdentityObserved: true;
  setupCompleted: true;
  workspaceId: string;
  threadId: string;
  runId: string;
  runStatus: "completed";
  model: string;
  executorContainerId: string;
  executorReceipt: Readonly<{
    serviceId: string;
    leaseVersion: number;
    recordedAt: string;
  }>;
  assistantOutputDigest: string;
  cleanup: Readonly<{ workspace: "deleted" }>;
  pollCount: number;
}>;

export type AuthenticatedStagingFunctionalProofOptions = Readonly<{
  transport: AuthenticatedOwnerSessionTransport;
  sourceCommit: string;
  publicUrl: string;
  servedVersion: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}>;

export type LocalAgentProof = {
  readonly kind: "takos.local-agent-run-proof@v1";
  readonly spaceId: string;
  readonly threadId: string;
  readonly runId: string;
  readonly status: "completed";
  readonly observedStatuses: readonly string[];
  readonly eventTypes: readonly string[];
  readonly workspaceListObserved: true;
  readonly runOutputObserved: true;
  readonly assistantMessageObserved: true;
  readonly terminalEventObserved: true;
  readonly pollCount: number;
};

export type LocalAgentProofOptions = {
  readonly workerBaseUrl: string;
  readonly proofRuntimeBaseUrl: string;
  readonly proofSecret: string;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
};

/**
 * Exercise the actual public Takos API and wait for durable agent evidence.
 *
 * The proof-only bootstrap endpoint exists solely to mint a local issuer token
 * and seed its matching user identity. Thread, message, run creation, run
 * observation, event replay, and message observation all go through `/api`.
 */
export async function runLocalAgentPublicApiProof(
  options: LocalAgentProofOptions,
): Promise<LocalAgentProof> {
  throwIfAborted(options.signal);
  const fetchImpl = withParentSignal(
    options.fetchImpl ?? fetch,
    options.signal,
  );
  const sleep =
    options.sleep ??
    ((milliseconds: number) => abortableDelay(milliseconds, options.signal));
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const workerBaseUrl = normalizedBaseUrl(options.workerBaseUrl);
  const proofRuntimeBaseUrl = normalizedBaseUrl(options.proofRuntimeBaseUrl);

  const bootstrap = await requestJson(
    fetchImpl,
    "local proof auth bootstrap",
    `${proofRuntimeBaseUrl}/__proof/bootstrap`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.proofSecret}`,
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  const accessToken = requiredString(bootstrap, "accessToken");
  const authHeaders = {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  };

  const spaceResponse = await requestJson(
    fetchImpl,
    "public workspace create",
    `${workerBaseUrl}/api/spaces`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: `Local agent proof ${now()}`,
        installFeaturedApps: false,
      }),
    },
  );
  const spaceId = requiredNestedString(spaceResponse, "space", "id");
  const spacesResponse = await requestJson(
    fetchImpl,
    "public workspace list",
    `${workerBaseUrl}/api/spaces`,
    { headers: authHeaders },
  );
  if (
    !arrayRecords(spacesResponse.spaces).some((space) => space.id === spaceId)
  ) {
    throw new Error(
      "public workspace list did not include the created workspace",
    );
  }

  const threadResponse = await requestJson(
    fetchImpl,
    "public thread create",
    `${workerBaseUrl}/api/spaces/${encodeURIComponent(spaceId)}/threads`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        title: "Local agent execution proof",
        locale: "en",
      }),
    },
  );
  const threadId = requiredNestedString(threadResponse, "thread", "id");

  await requestJson(
    fetchImpl,
    "public user message create",
    `${workerBaseUrl}/api/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        role: "user",
        content: "Return the deterministic local agent proof response.",
      }),
    },
  );

  const runResponse = await requestJson(
    fetchImpl,
    "public run create",
    `${workerBaseUrl}/api/threads/${encodeURIComponent(threadId)}/runs`,
    {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        agent_type: "default",
        model: "gpt-5.5",
        input: { proof: "local-compose-agent-container" },
      }),
    },
  );
  const runId = requiredNestedString(runResponse, "run", "id");
  const initialStatus = nestedString(runResponse, "run", "status");
  const observedStatuses = new Set<string>();
  if (initialStatus) observedStatuses.add(initialStatus);

  const deadline = now() + timeoutMs;
  let pollCount = 0;
  let lastRun: JsonRecord | null = null;
  let eventTypes: string[] = [];
  let assistantMessageObserved = false;

  while (now() < deadline) {
    pollCount += 1;
    const [runDetail, events, timeline] = await Promise.all([
      requestJson(
        fetchImpl,
        "public run detail",
        `${workerBaseUrl}/api/runs/${encodeURIComponent(runId)}`,
        { headers: authHeaders },
      ),
      requestJson(
        fetchImpl,
        "public run events",
        `${workerBaseUrl}/api/runs/${encodeURIComponent(runId)}/events`,
        { headers: authHeaders },
      ),
      requestJson(
        fetchImpl,
        "public thread messages",
        `${workerBaseUrl}/api/threads/${encodeURIComponent(threadId)}/messages`,
        { headers: authHeaders },
      ),
    ]);

    const run = recordValue(runDetail.run);
    lastRun = run;
    const status = run && typeof run.status === "string" ? run.status : null;
    if (!run || !status) {
      throw new Error("public run detail did not include run.status");
    }
    observedStatuses.add(status);

    eventTypes = arrayRecords(events.events)
      .map((event) => event.type)
      .filter((type): type is string => typeof type === "string");
    assistantMessageObserved = arrayRecords(timeline.messages).some(
      (message) =>
        message.role === "assistant" &&
        typeof message.content === "string" &&
        message.content.includes(LOCAL_AGENT_PROOF_ASSISTANT_MARKER),
    );
    const terminalEventObserved = eventTypes.includes(
      status === "failed" ? "error" : status,
    );
    const runOutputObserved =
      typeof run.output === "string" &&
      run.output.includes(LOCAL_AGENT_PROOF_ASSISTANT_MARKER);

    if (TERMINAL_STATUSES.has(status)) {
      if (status !== "completed") {
        const error =
          typeof run.error === "string" ? run.error : "no run error";
        throw new Error(
          `agent run reached terminal status ${status}: ${error}; events=${eventTypes.join(",")}`,
        );
      }
      if (
        runOutputObserved &&
        assistantMessageObserved &&
        terminalEventObserved
      ) {
        if (!eventTypes.includes("started")) {
          throw new Error(
            `agent run completed without a started event; events=${eventTypes.join(",")}`,
          );
        }
        return {
          kind: "takos.local-agent-run-proof@v1",
          spaceId,
          threadId,
          runId,
          status,
          observedStatuses: [...observedStatuses],
          eventTypes,
          workspaceListObserved: true,
          runOutputObserved: true,
          assistantMessageObserved: true,
          terminalEventObserved: true,
          pollCount,
        };
      }
    }

    await sleep(pollIntervalMs);
    throwIfAborted(options.signal);
  }

  const lastStatus =
    typeof lastRun?.status === "string" ? lastRun.status : "unknown";
  throw new Error(
    `agent run proof timed out after ${timeoutMs}ms ` +
      `(run=${runId}, status=${lastStatus}, output=${
        typeof lastRun?.output === "string" &&
        lastRun.output.includes(LOCAL_AGENT_PROOF_ASSISTANT_MARKER)
      }, assistant=${assistantMessageObserved}, ` +
      `events=${eventTypes.join(",") || "none"})`,
  );
}

/**
 * Prove the first installed Takos through its public authenticated surface.
 *
 * This consumes an already-authenticated owner-session transport. It does not
 * mint credentials, automate OIDC/MFA, accept a raw bearer, or choose a model.
 * Omitting `model` from run creation is intentional: the Workspace's resolved
 * owner configuration is the authority, and `local-smoke` is rejected even if
 * a server attempts to select it.
 */
export async function runAuthenticatedStagingFunctionalProof(
  options: AuthenticatedStagingFunctionalProofOptions,
): Promise<FirstInstallFunctionalProof> {
  throwIfAborted(options.signal);
  if (
    options.transport?.kind !==
    "takos.authenticated-owner-session-transport@v1"
  ) {
    throw new Error("an already-authenticated owner session transport is required");
  }
  if (!/^[0-9a-f]{40}$/u.test(options.sourceCommit)) {
    throw new Error("sourceCommit must be a full lowercase commit id");
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
      .test(options.servedVersion)
  ) {
    throw new Error("servedVersion must be an immutable Worker version id");
  }
  const publicUrl = normalizedStagingOrigin(options.publicUrl);
  const now = options.now ?? Date.now;
  const sleep = options.sleep ??
    ((milliseconds: number) => abortableDelay(milliseconds, options.signal));
  const timeoutMs = options.timeoutMs ?? 180_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600_000 ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 0 ||
    pollIntervalMs > 10_000
  ) {
    throw new Error("functional proof timeout/poll interval is outside its bound");
  }
  const checks: FirstInstallFunctionalCheck[] = [];

  const request = async (
    label: string,
    input: AuthenticatedOwnerSessionRequest,
    expectedStatus: number,
  ): Promise<JsonRecord> => {
    throwIfAborted(options.signal);
    const response = await options.transport.request(input);
    checks.push({
      name: label as FirstInstallFunctionalCheck["name"],
      status: response.status,
      bodyDigest: digestJson(response.body),
    });
    if (response.status !== expectedStatus) {
      throw new Error(`${label} answered ${response.status}, expected ${expectedStatus}`);
    }
    const body = recordValue(response.body);
    if (!body) throw new Error(`${label} returned a non-object response`);
    return body;
  };

  const health = await request(
    "health",
    { scope: "anonymous", method: "GET", path: "/health" },
    200,
  );
  if (health.status !== "ok") throw new Error("health body did not report ok");
  await request(
    "auth-boundary",
    { scope: "anonymous", method: "GET", path: "/api/auth/me" },
    401,
  );
  const currentUser = await request(
    "oidc-owner",
    { scope: "owner", method: "GET", path: "/api/auth/me" },
    200,
  );
  const user = recordValue(currentUser.user);
  if (
    !user ||
    !arrayRecords(user.auth_identities).some(
      (identity) => identity.source === "oidc",
    )
  ) {
    throw new Error("authenticated owner has no OIDC identity evidence");
  }

  let setup = await request(
    "setup",
    { scope: "owner", method: "GET", path: "/api/setup/status" },
    200,
  );
  if (setup.setup_completed !== true) {
    await request(
      "setup",
      { scope: "owner", method: "POST", path: "/api/setup/complete", body: {} },
      200,
    );
    setup = await request(
      "setup",
      { scope: "owner", method: "GET", path: "/api/setup/status" },
      200,
    );
  }
  if (setup.setup_completed !== true) {
    throw new Error("owner setup did not read back complete");
  }

  let workspaceId: string | null = null;
  let proof: Omit<FirstInstallFunctionalProof, "checks" | "cleanup" | "checkedAt"> | null = null;
  let primaryError: unknown = null;
  try {
    const created = await request(
      "workspace",
      {
        scope: "owner",
        method: "POST",
        path: "/api/spaces",
        body: {
          name: `First install functional proof ${now()}`,
          installFeaturedApps: false,
        },
      },
      201,
    );
    workspaceId = boundedApiId(
      requiredNestedString(created, "space", "id"),
      "workspace id",
    );
    const listed = await request(
      "workspace",
      { scope: "owner", method: "GET", path: "/api/spaces" },
      200,
    );
    if (!arrayRecords(listed.spaces).some((space) => space.id === workspaceId)) {
      throw new Error("created proof Workspace did not read back in owner list");
    }

    const threadCreated = await request(
      "chat",
      {
        scope: "owner",
        method: "POST",
        path: `/api/spaces/${encodeURIComponent(workspaceId)}/threads`,
        body: { title: "First install agent proof", locale: "en" },
      },
      201,
    );
    const threadId = boundedApiId(
      requiredNestedString(threadCreated, "thread", "id"),
      "thread id",
    );
    await request(
      "chat",
      {
        scope: "owner",
        method: "POST",
        path: `/api/threads/${encodeURIComponent(threadId)}/messages`,
        body: {
          role: "user",
          content: "Reply with a short confirmation that this installed Takos agent ran.",
        },
      },
      201,
    );
    const runCreated = await request(
      "agent-run",
      {
        scope: "owner",
        method: "POST",
        path: `/api/threads/${encodeURIComponent(threadId)}/runs`,
        body: {
          agent_type: "default",
          input: { proof: "takos-first-install-functional" },
        },
      },
      201,
    );
    const runId = boundedApiId(
      requiredNestedString(runCreated, "run", "id"),
      "run id",
    );
    const createdModel = nestedString(runCreated, "run", "model");
    assertRealModel(createdModel);

    const observedStatuses = new Set<string>();
    const initialStatus = nestedString(runCreated, "run", "status");
    if (initialStatus) observedStatuses.add(initialStatus);
    const deadline = now() + timeoutMs;
    let pollCount = 0;
    let terminalRun: JsonRecord | null = null;
    let assistantOutput: string | null = null;
    let receipt: {
      executorContainerId: string;
      serviceId: string;
      leaseVersion: number;
      recordedAt: string;
    } | null = null;
    let eventTypes: string[] = [];

    while (now() < deadline) {
      pollCount += 1;
      const [runResponse, eventResponse, messageResponse] = await Promise.all([
        options.transport.request({
          scope: "owner",
          method: "GET",
          path: `/api/runs/${encodeURIComponent(runId)}`,
        }),
        options.transport.request({
          scope: "owner",
          method: "GET",
          path: `/api/runs/${encodeURIComponent(runId)}/events`,
        }),
        options.transport.request({
          scope: "owner",
          method: "GET",
          path: `/api/threads/${encodeURIComponent(threadId)}/messages`,
        }),
      ]);
      for (const [label, response] of [
        ["run detail", runResponse],
        ["run events", eventResponse],
        ["thread messages", messageResponse],
      ] as const) {
        if (response.status !== 200) {
          throw new Error(`${label} answered ${response.status}`);
        }
      }
      const runBody = recordValue(runResponse.body);
      const run = recordValue(runBody?.run);
      if (!run || typeof run.status !== "string") {
        throw new Error("run detail did not include run.status");
      }
      observedStatuses.add(run.status);
      assertRealModel(typeof run.model === "string" ? run.model : createdModel);
      const eventBody = recordValue(eventResponse.body);
      const events = arrayRecords(eventBody?.events);
      eventTypes = events.flatMap((event) =>
        typeof event.type === "string" ? [event.type] : []
      );
      const terminalServiceId = typeof run.worker_id === "string"
        ? run.worker_id
        : null;
      for (const event of events) {
        if (event.type !== "executor_dispatch_receipt") continue;
        const data = parseEventData(event.data);
        const executorContainerId = data?.executor_container_id;
        const serviceId = data?.service_id;
        const leaseVersion = data?.lease_version;
        const recordedAt = data?.recorded_at;
        if (
          typeof executorContainerId === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(executorContainerId) &&
          typeof serviceId === "string" &&
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(serviceId) &&
          serviceId === terminalServiceId &&
          typeof leaseVersion === "number" && Number.isSafeInteger(leaseVersion) && leaseVersion > 0 &&
          typeof recordedAt === "string" &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(recordedAt) &&
          new Date(recordedAt).toISOString() === recordedAt
        ) {
          receipt = { executorContainerId, serviceId, leaseVersion, recordedAt };
        }
      }
      const messageBody = recordValue(messageResponse.body);
      assistantOutput = arrayRecords(messageBody?.messages)
        .filter(
          (message) =>
            message.role === "assistant" &&
            typeof message.content === "string" &&
            message.content.trim().length > 0,
        )
        .map((message) => String(message.content).trim())
        .at(-1) ?? null;

      if (TERMINAL_STATUSES.has(run.status)) {
        if (run.status !== "completed") {
          throw new Error(`agent run reached terminal status ${run.status}`);
        }
        terminalRun = run;
        const output = typeof run.output === "string" ? run.output.trim() : "";
        if (
          output &&
          assistantOutput &&
          eventTypes.includes("started") &&
          eventTypes.includes("completed") &&
          receipt
        ) {
          break;
        }
      }
      await sleep(pollIntervalMs);
      throwIfAborted(options.signal);
    }

    if (!terminalRun) throw new Error(`agent run proof timed out after ${timeoutMs}ms`);
    const output = typeof terminalRun.output === "string"
      ? terminalRun.output.trim()
      : "";
    if (!output || !assistantOutput) {
      throw new Error("completed agent run has no nonempty assistant output");
    }
    if (!eventTypes.includes("started") || !eventTypes.includes("completed")) {
      throw new Error("completed agent run lacks started/completed event evidence");
    }
    if (!receipt) {
      throw new Error("completed agent run lacks a real executor_container_id receipt");
    }
    const model = typeof terminalRun.model === "string"
      ? terminalRun.model
      : createdModel;
    assertRealModel(model);
    checks.push({
      name: "agent-run",
      status: 200,
      bodyDigest: digestJson({
        runId,
        status: "completed",
        model,
        executorReceipt: receipt,
        outputDigest: digestText(output),
      }),
    });
    proof = {
      kind: "takos.first-install-functional-proof@v1",
      status: "passed",
      sourceCommit: options.sourceCommit,
      publicUrl,
      servedVersion: options.servedVersion,
      oidcIdentityObserved: true,
      setupCompleted: true,
      workspaceId,
      threadId,
      runId,
      runStatus: "completed",
      model,
      executorContainerId: receipt.executorContainerId,
      executorReceipt: {
        serviceId: receipt.serviceId,
        leaseVersion: receipt.leaseVersion,
        recordedAt: receipt.recordedAt,
      },
      assistantOutputDigest: digestText(output),
      pollCount,
    };
  } catch (error) {
    primaryError = error;
  }

  let cleanupError: Error | null = null;
  if (workspaceId) {
    try {
      const cleanup = await options.transport.request({
        scope: "owner",
        method: "DELETE",
        path: `/api/spaces/${encodeURIComponent(workspaceId)}`,
      });
      checks.push({
        name: "cleanup",
        status: cleanup.status,
        bodyDigest: digestJson(cleanup.body),
      });
      const body = recordValue(cleanup.body);
      if (cleanup.status !== 200 || body?.success !== true) {
        throw new Error(`cleanup answered ${cleanup.status} without success`);
      }
    } catch (error) {
      cleanupError = new Error(
        `functional proof cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (primaryError) {
    if (cleanupError) {
      throw new AggregateError([primaryError, cleanupError], "functional proof and cleanup failed");
    }
    throw primaryError;
  }
  if (cleanupError) throw cleanupError;
  if (!proof || !workspaceId) throw new Error("functional proof produced no result");
  return {
    ...proof,
    checkedAt: new Date(now()).toISOString(),
    checks,
    cleanup: { workspace: "deleted" },
  };
}

function digestText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestJson(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value) ?? "null";
  } catch {
    serialized = "[unserializable]";
  }
  return digestText(serialized);
}

function normalizedStagingOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1"
  ) {
    throw new Error("publicUrl must be a canonical non-local HTTPS origin");
  }
  return url.origin;
}

function assertRealModel(model: string | null): asserts model is string {
  if (
    !model ||
    model.trim().length === 0 ||
    model.length > 256 ||
    [...model].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  ) {
    throw new Error("agent run did not expose its resolved model");
  }
  if (model.trim().toLowerCase() === "local-smoke") {
    throw new Error("local-smoke is not a real staging agent model");
  }
}

function boundedApiId(value: string, label: string): string {
  if (
    value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
  ) {
    throw new Error(`${label} is not a bounded public identity`);
  }
  return value;
}

function parseEventData(value: unknown): JsonRecord | null {
  if (typeof value === "string") {
    try {
      return recordValue(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  return recordValue(value);
}

function withParentSignal(
  fetchImpl: typeof fetch,
  parentSignal: AbortSignal | undefined,
): typeof fetch {
  if (!parentSignal) return fetchImpl;
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const requestSignal = init?.signal;
    const signal = requestSignal
      ? AbortSignal.any([parentSignal, requestSignal])
      : parentSignal;
    return fetchImpl(input, { ...init, signal });
  }) as typeof fetch;
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("local agent proof aborted"));
    }
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new Error("local agent proof aborted");
}

async function requestJson(
  fetchImpl: typeof fetch,
  label: string,
  url: string,
  init: RequestInit,
): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(
      `${label} request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await response.text();
  let value: unknown;
  try {
    value = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label} returned non-JSON (${response.status}): ${text}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${text}`);
  }
  const record = recordValue(value);
  if (!record) throw new Error(`${label} returned a non-object JSON value`);
  return record;
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function recordValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value
        .map(recordValue)
        .filter((entry): entry is JsonRecord => entry !== null)
    : [];
}

function requiredString(record: JsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`expected ${key} in local proof response`);
  }
  return value;
}

function nestedString(
  record: JsonRecord,
  objectKey: string,
  key: string,
): string | null {
  const nested = recordValue(record[objectKey]);
  const value = nested?.[key];
  return typeof value === "string" && value ? value : null;
}

function requiredNestedString(
  record: JsonRecord,
  objectKey: string,
  key: string,
): string {
  const value = nestedString(record, objectKey, key);
  if (!value)
    throw new Error(`expected ${objectKey}.${key} in public API response`);
  return value;
}
