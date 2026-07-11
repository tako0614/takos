export const LOCAL_AGENT_PROOF_ASSISTANT_MARKER =
  "local-agent-proof: queue -> agent container -> terminal";

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

type JsonRecord = Record<string, unknown>;

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

    lastRun = recordValue(runDetail.run);
    const status = typeof lastRun?.status === "string" ? lastRun.status : null;
    if (!status) {
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
      typeof lastRun.output === "string" &&
      lastRun.output.includes(LOCAL_AGENT_PROOF_ASSISTANT_MARKER);

    if (TERMINAL_STATUSES.has(status)) {
      if (status !== "completed") {
        const error =
          typeof lastRun.error === "string" ? lastRun.error : "no run error";
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
