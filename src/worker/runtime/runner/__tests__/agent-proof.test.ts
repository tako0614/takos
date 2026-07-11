import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";
import { getTableName } from "drizzle-orm";
import {
  handleCompleteRun,
  handleRunEvent,
} from "../../container-hosts/executor-control-rpc.ts";
import { handleQueue } from "../queue-handler.ts";
import {
  RUN_QUEUE_MESSAGE_VERSION,
  type RunQueueMessage,
} from "../../../shared/types/index.ts";

type RunState = {
  id: string;
  threadId: string;
  accountId: string;
  requesterAccountId: string;
  sessionId: string | null;
  agentType: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  usage: string;
  serviceId: string | null;
  serviceHeartbeat: string | null;
  leaseVersion: number;
  startedAt: string | null;
  completedAt: string | null;
  completionKey: string | null;
  createdAt: string;
};

type MessageState = {
  id: string;
  threadId: string;
  role: string;
  content: string;
  r2Key: string | null;
  toolCalls: string | null;
  toolCallId: string | null;
  metadata: string;
  sequence: number;
  createdAt: string;
};

type RunEventState = {
  id: number;
  runId: string;
  type: string;
  eventKey: string | null;
  data: string;
  createdAt: string;
};

type MemoryClaimState = {
  id: string;
  accountId: string;
  claimType: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  status: string;
  sourceRunId: string | null;
};

type MemoryEvidenceState = {
  id: string;
  accountId: string;
  claimId: string;
  kind: string;
  sourceType: string;
  sourceRef: string | null;
  content: string;
};

type IndexJobState = {
  id: string;
  accountId: string;
  type: string;
  targetId: string;
  status: string;
  error: string | null;
  claimToken: string | null;
  startedAt: string | null;
  createdAt: string;
};

type AgentProofState = {
  run: RunState;
  requesterHasAccess?: boolean;
  messages: MessageState[];
  runEvents: RunEventState[];
  memoryClaims: MemoryClaimState[];
  memoryEvidence: MemoryEvidenceState[];
  indexJobs: IndexJobState[];
  notifierPayloads: unknown[];
  indexMessages: unknown[];
  runQueueMessages: Array<{
    message: unknown;
    options: { delaySeconds?: number } | undefined;
  }>;
};

test("run queue dispatch accepts agent container control RPC side effects", async () => {
  const state: AgentProofState = {
    run: {
      id: "run_agent_proof",
      threadId: "thread_agent_proof",
      accountId: "space_agent_proof",
      requesterAccountId: "user_agent_proof",
      sessionId: null,
      agentType: "default",
      status: "queued",
      input: JSON.stringify({ prompt: "remember the agent proof" }),
      output: null,
      error: null,
      usage: "{}",
      serviceId: null,
      serviceHeartbeat: null,
      leaseVersion: 0,
      startedAt: null,
      completedAt: null,
      completionKey: null,
      createdAt: "2026-06-02T00:00:00.000Z",
    },
    messages: [
      {
        id: "msg_user_agent_proof",
        threadId: "thread_agent_proof",
        role: "user",
        content: "remember the agent proof",
        r2Key: null,
        toolCalls: null,
        toolCallId: null,
        metadata: "{}",
        sequence: 0,
        createdAt: "2026-06-02T00:00:00.000Z",
      },
    ],
    runEvents: [],
    memoryClaims: [],
    memoryEvidence: [],
    indexJobs: [],
    notifierPayloads: [],
    indexMessages: [],
    runQueueMessages: [],
  };
  const dispatches: Array<Record<string, unknown>> = [];
  const env = createAgentProofEnv(state, dispatches);
  const message = createQueueMessage({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: state.run.id,
    timestamp: Date.now(),
    retryCount: 0,
    model: "gpt-5.5",
  });

  await handleQueue(
    {
      queue: "takos-runs",
      messages: [message],
    },
    env as never,
  );

  assertEquals(message.acks, 1);
  assertEquals(message.retries, 0);
  assertEquals(dispatches.length, 1);
  assertEquals(dispatches[0].runId, state.run.id);
  assertEquals(dispatches[0].model, "gpt-5.5");
  assert(typeof dispatches[0].serviceId === "string");
  assertEquals(dispatches[0].workerId, dispatches[0].serviceId);
  assertEquals(dispatches[0].leaseVersion, 1);

  assertEquals(state.run.status, "completed");
  assertEquals(state.run.output, "Agent proof complete");
  assertEquals(JSON.parse(state.run.usage), {
    inputTokens: 12,
    outputTokens: 8,
  });
  assertEquals(
    state.messages
      .filter((row) => row.role === "assistant")
      .map((row) => row.content),
    ["Agent proof complete"],
  );
  assertEquals(state.memoryClaims.length, 0);
  assertEquals(state.memoryEvidence.length, 0);
  assertEquals(
    state.runEvents.map((event) => event.type),
    ["started", "progress", "completed"],
  );
  assertEquals(state.notifierPayloads.length, 4);
  assert(
    state.notifierPayloads.some(
      (payload) =>
        typeof payload === "object" &&
        payload !== null &&
        String((payload as Record<string, unknown>).dedup_key).includes(
          ":message:0",
        ),
    ),
  );
  assertEquals(
    state.indexMessages.map((message) => {
      const item = message as Record<string, unknown>;
      return { type: item.type, targetId: item.targetId };
    }),
    [
      { type: "info_unit", targetId: state.run.id },
      { type: "thread_context", targetId: state.run.threadId },
    ],
  );
  assertEquals(
    state.indexJobs.map((job) => job.status),
    ["enqueued", "enqueued"],
  );
  assertEquals(
    state.indexJobs.map((job) => job.claimToken),
    state.indexMessages.map(
      (message) => (message as Record<string, unknown>).deliveryId,
    ),
  );
});

test("run queue retries transient executor dispatch exceptions", async () => {
  const state: AgentProofState = {
    run: {
      id: "run_dispatch_retry",
      threadId: "thread_dispatch_retry",
      accountId: "space_dispatch_retry",
      requesterAccountId: "user_dispatch_retry",
      sessionId: null,
      agentType: "default",
      status: "queued",
      input: JSON.stringify({ prompt: "retry dispatch" }),
      output: null,
      error: null,
      usage: "{}",
      serviceId: null,
      serviceHeartbeat: null,
      leaseVersion: 0,
      startedAt: null,
      completedAt: null,
      completionKey: null,
      createdAt: "2026-06-02T00:00:00.000Z",
    },
    messages: [],
    runEvents: [],
    memoryClaims: [],
    memoryEvidence: [],
    indexJobs: [],
    notifierPayloads: [],
    indexMessages: [],
    runQueueMessages: [],
  };
  const message = createQueueMessage({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: state.run.id,
    timestamp: Date.now(),
    retryCount: 0,
    model: "takosumi/default",
  });
  const env = createAgentProofEnv(state, []);
  env.EXECUTOR_HOST.fetch = async () => {
    throw new Error("Network connection lost");
  };

  await handleQueue(
    {
      queue: "takos-runs",
      messages: [message],
    },
    env as never,
  );

  assertEquals(message.acks, 0);
  assertEquals(message.retries, 1);
  assertEquals(message.retryDelays, [5]);
  assertEquals(state.run.status, "queued");
  assertEquals(state.run.serviceId, null);
  assertEquals(state.run.serviceHeartbeat, null);
  assertEquals(state.run.completedAt, null);
  assertEquals(
    state.run.error,
    "Dispatch exception: Error: Network connection lost",
  );
});

test("run queue re-enqueues executor capacity backpressure without consuming delivery retries", async () => {
  const state = createQueuedAgentProofState(
    "run_capacity_backpressure",
    "wait for executor capacity",
  );
  const env = createAgentProofEnv(state, []);
  env.EXECUTOR_HOST.fetch = async () =>
    Response.json(
      { success: false, error: "No executor capacity available" },
      { status: 503 },
    );
  const message = createQueueMessage({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: state.run.id,
    timestamp: Date.now(),
    retryCount: 0,
    backpressureCount: 6,
    model: "takosumi/default",
  });

  await handleQueue(
    {
      queue: "takos-runs",
      messages: [message],
    },
    env as never,
  );

  assertEquals(message.acks, 1);
  assertEquals(message.retries, 0);
  assertEquals(state.run.status, "queued");
  assertEquals(state.run.serviceId, null);
  assertEquals(state.run.completedAt, null);
  assertEquals(state.run.error, null);
  assertEquals(state.runQueueMessages.length, 1);
  assertEquals(state.runQueueMessages[0].options, { delaySeconds: 300 });
  assertEquals(state.runQueueMessages[0].message, {
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: state.run.id,
    timestamp: message.body.timestamp,
    retryCount: 0,
    backpressureCount: 7,
    model: "takosumi/default",
  });
});

test("run queue retains the original delivery when capacity requeue fails", async () => {
  const state = createQueuedAgentProofState(
    "run_capacity_requeue_failure",
    "retry failed requeue",
  );
  const env = createAgentProofEnv(state, []);
  env.EXECUTOR_HOST.fetch = async () =>
    Response.json({ error: "At capacity" }, { status: 503 });
  env.RUN_QUEUE.send = async () => {
    throw new Error("queue producer unavailable");
  };
  const message = createQueueMessage({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: state.run.id,
    timestamp: Date.now(),
    backpressureCount: 0,
  });

  await handleQueue(
    {
      queue: "takos-runs",
      messages: [message],
    },
    env as never,
  );

  assertEquals(message.acks, 0);
  assertEquals(message.retries, 1);
  assertEquals(message.retryDelays, [5]);
  assertEquals(state.run.status, "queued");
  assertEquals(state.run.serviceId, null);
  assertEquals(state.run.error, null);
});

test("run queue terminalizes a queued Run after requester membership revocation", async () => {
  const state = createQueuedAgentProofState(
    "run_membership_revoked",
    "must not dispatch",
  );
  state.requesterHasAccess = false;
  const dispatches: Array<Record<string, unknown>> = [];
  const env = createAgentProofEnv(state, dispatches);
  const message = createQueueMessage({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId: state.run.id,
    timestamp: Date.now(),
    model: "gpt-5.5",
  });

  await handleQueue({ queue: "takos-runs", messages: [message] }, env as never);

  assertEquals(message.acks, 1);
  assertEquals(message.retries, 0);
  assertEquals(dispatches.length, 0);
  assertEquals(state.run.status, "failed");
  assertEquals(
    state.run.error,
    "Run requester no longer has access to this Workspace",
  );
});

function createQueuedAgentProofState(
  runId: string,
  prompt: string,
): AgentProofState {
  return {
    run: {
      id: runId,
      threadId: `thread_${runId}`,
      accountId: `space_${runId}`,
      requesterAccountId: `user_${runId}`,
      sessionId: null,
      agentType: "default",
      status: "queued",
      input: JSON.stringify({ prompt }),
      output: null,
      error: null,
      usage: "{}",
      serviceId: null,
      serviceHeartbeat: null,
      leaseVersion: 0,
      startedAt: null,
      completedAt: null,
      completionKey: null,
      createdAt: "2026-06-02T00:00:00.000Z",
    },
    messages: [],
    runEvents: [],
    memoryClaims: [],
    memoryEvidence: [],
    indexJobs: [],
    notifierPayloads: [],
    indexMessages: [],
    runQueueMessages: [],
  };
}

function createAgentProofEnv(
  state: AgentProofState,
  dispatches: Array<Record<string, unknown>>,
) {
  return {
    DB: createAgentProofDb(state),
    RUN_QUEUE: {
      async send(message: unknown, options?: { delaySeconds?: number }) {
        state.runQueueMessages.push({ message, options });
      },
    },
    RUN_NOTIFIER: {
      idFromName(name: string) {
        return name;
      },
      get() {
        return {
          async fetch(request: Request) {
            state.notifierPayloads.push(await request.json());
            return Response.json({ ok: true });
          },
        };
      },
    },
    INDEX_QUEUE: {
      async send(message: unknown) {
        state.indexMessages.push(message);
      },
    },
    EXECUTOR_HOST: {
      async fetch(request: Request) {
        assertEquals(new URL(request.url).pathname, "/dispatch");
        assertEquals(request.method, "POST");
        const body = (await request.json()) as Record<string, unknown>;
        dispatches.push(body);
        await acceptedAgentContainerRun(state, body);
        return Response.json({ accepted: true }, { status: 202 });
      },
    },
  };
}

async function acceptedAgentContainerRun(
  state: AgentProofState,
  dispatch: Record<string, unknown>,
): Promise<void> {
  const env = createAgentProofEnv(state, []);
  const runId = String(dispatch.runId);
  assertEquals(runId, state.run.id);
  assertEquals(dispatch.model, "gpt-5.5");

  assertResponseOk(
    await handleRunEvent(
      {
        runId,
        type: "started",
        sequence: 1,
        data: { workerId: dispatch.workerId, model: dispatch.model },
      },
      env as never,
    ),
  );
  assertResponseOk(
    await handleRunEvent(
      {
        runId,
        type: "progress",
        sequence: 2,
        data: { message: "agent container accepted run" },
      },
      env as never,
    ),
  );
  assertResponseOk(
    await handleCompleteRun(
      {
        runId,
        serviceId: dispatch.serviceId,
        leaseVersion: dispatch.leaseVersion,
        status: "completed",
        usage: { inputTokens: 12, outputTokens: 8 },
        output: "Agent proof complete",
        messages: [{ role: "assistant", content: "Agent proof complete" }],
      },
      env as never,
    ),
  );
}

function assertResponseOk(response: Response): void {
  assert(response.ok, `expected response ok, got ${response.status}`);
}

function createQueueMessage(body: RunQueueMessage) {
  return {
    body,
    attempts: 1,
    acks: 0,
    retries: 0,
    retryDelays: [] as number[],
    ack() {
      this.acks += 1;
    },
    retry(options?: { delaySeconds?: number }) {
      this.retries += 1;
      if (options?.delaySeconds != null) {
        this.retryDelays.push(options.delaySeconds);
      }
    },
  };
}

function createAgentProofDb(state: AgentProofState) {
  const db = {
    select(fields?: Record<string, unknown>) {
      return {
        from(table: unknown) {
          const name = tableName(table);
          return {
            where() {
              return {
                get: async () => selectFirst(state, name, fields),
                all: async () => selectAll(state, name),
                limit() {
                  return { all: async () => selectAll(state, name) };
                },
              };
            },
          };
        },
      };
    },
    insert(table: unknown) {
      const name = tableName(table);
      return {
        values(values: Record<string, unknown>) {
          return insertRow(state, name, values);
        },
      };
    },
    update(table: unknown) {
      const name = tableName(table);
      return {
        set(values: Record<string, unknown>) {
          return {
            where: async () => updateRows(state, name, values),
          };
        },
      };
    },
    delete() {
      return {
        where: async () => ({ meta: { changes: 0 } }),
      };
    },
    prepare(sql: string) {
      return createRawStatement(state, sql);
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
  return db;
}

function selectFirst(
  state: AgentProofState,
  table: string,
  fields?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (table === "runs") {
    if (
      fields &&
      Object.keys(fields).length === 1 &&
      "leaseVersion" in fields
    ) {
      return { leaseVersion: state.run.leaseVersion };
    }
    return {
      status: state.run.status,
      usage: state.run.usage,
      output: state.run.output,
      error: state.run.error,
      accountId: state.run.accountId,
      threadId: state.run.threadId,
      sessionId: state.run.sessionId,
      serviceId: state.run.serviceId,
      leaseVersion: state.run.leaseVersion,
      completionKey: state.run.completionKey,
      requesterAccountId: state.run.requesterAccountId,
      model: "gpt-5.5",
    };
  }
  if (table === "accounts") {
    const idOnly = fields && Object.keys(fields).length === 1 && "id" in fields;
    return {
      id: state.run.requesterAccountId,
      ...(idOnly
        ? {}
        : {
            ownerAccountId:
              state.requesterHasAccess === false
                ? "another-owner"
                : state.run.requesterAccountId,
          }),
      type: "user",
      securityPosture: "standard",
    };
  }
  if (table === "threads") {
    // The run's thread belongs to the run's account (the control-RPC handlers
    // bind tenant/thread to the token-bound run).
    return { accountId: state.run.accountId };
  }
  if (table === "messages") {
    if (fields && "maxSeq" in fields) {
      return {
        maxSeq: Math.max(
          -1,
          ...state.messages
            .filter((row) => row.threadId === state.run.threadId)
            .map((row) => row.sequence),
        ),
      };
    }
    return null;
  }
  if (table === "run_events") {
    return null;
  }
  return null;
}

function selectAll(
  state: AgentProofState,
  table: string,
): Record<string, unknown>[] {
  if (table === "messages") return state.messages;
  if (table === "run_events") return state.runEvents;
  if (table === "index_jobs") return state.indexJobs;
  return [];
}

function insertRow(
  state: AgentProofState,
  table: string,
  values: Record<string, unknown>,
) {
  if (table === "messages") {
    state.messages.push({
      id: String(values.id),
      threadId: String(values.threadId),
      role: String(values.role),
      content: String(values.content),
      r2Key: typeof values.r2Key === "string" ? values.r2Key : null,
      toolCalls: typeof values.toolCalls === "string" ? values.toolCalls : null,
      toolCallId:
        typeof values.toolCallId === "string" ? values.toolCallId : null,
      metadata: String(values.metadata ?? "{}"),
      sequence: Number(values.sequence ?? 0),
      createdAt: String(values.createdAt),
    });
    return {};
  }
  if (table === "run_events") {
    const id = state.runEvents.length + 1;
    state.runEvents.push({
      id,
      runId: String(values.runId),
      type: String(values.type),
      eventKey: typeof values.eventKey === "string" ? values.eventKey : null,
      data: String(values.data ?? "{}"),
      createdAt: String(values.createdAt),
    });
    return {
      returning() {
        return {
          get: async () => ({ id }),
        };
      },
    };
  }
  return {};
}

function updateRows(
  state: AgentProofState,
  table: string,
  values: Record<string, unknown>,
) {
  if (table === "index_jobs") {
    const nextStatus =
      typeof values.status === "string" ? values.status : undefined;
    const candidate = state.indexJobs.find((job) =>
      nextStatus === "enqueued"
        ? job.status === "queued"
        : nextStatus === "queued"
          ? job.status === "enqueued"
          : false,
    );
    if (!candidate || !nextStatus) return { meta: { changes: 0 } };
    candidate.status = nextStatus;
    candidate.startedAt =
      typeof values.startedAt === "string" ? values.startedAt : null;
    candidate.error = typeof values.error === "string" ? values.error : null;
    candidate.claimToken =
      typeof values.claimToken === "string" ? values.claimToken : null;
    return { meta: { changes: 1 } };
  }
  if (table !== "runs") return { meta: { changes: 0 } };
  if (values.status === "queued" && state.run.status !== "running") {
    return { meta: { changes: 0 } };
  }
  if (values.status === "running") {
    if (state.run.status !== "queued" || state.run.serviceId !== null) {
      return { meta: { changes: 0 } };
    }
    state.run.status = "running";
    state.run.startedAt = String(values.startedAt);
    state.run.serviceId = String(values.serviceId);
    state.run.serviceHeartbeat = String(values.serviceHeartbeat);
    state.run.leaseVersion += 1;
    return { meta: { changes: 1 } };
  }
  if (typeof values.status === "string") {
    state.run.status = values.status;
  }
  if (typeof values.output === "string") {
    state.run.output = values.output;
  }
  if (typeof values.error === "string") {
    state.run.error = values.error;
  }
  if (typeof values.usage === "string") {
    state.run.usage = values.usage;
  }
  if (typeof values.completedAt === "string") {
    state.run.completedAt = values.completedAt;
  } else if (values.completedAt === null) {
    state.run.completedAt = null;
  }
  if (typeof values.completionKey === "string") {
    state.run.completionKey = values.completionKey;
  } else if (values.completionKey === null) {
    state.run.completionKey = null;
  }
  if (typeof values.serviceId === "string") {
    state.run.serviceId = values.serviceId;
  } else if (values.serviceId === null) {
    state.run.serviceId = null;
  }
  if (typeof values.serviceHeartbeat === "string") {
    state.run.serviceHeartbeat = values.serviceHeartbeat;
  } else if (values.serviceHeartbeat === null) {
    state.run.serviceHeartbeat = null;
  }
  return { meta: { changes: 1 } };
}

function createRawStatement(state: AgentProofState, sql: string) {
  const statement = {
    bind(...values: unknown[]) {
      return {
        run: async () => {
          if (
            sql.includes('UPDATE "runs"') &&
            sql.includes('SET "status" = ?, "completed_at" = ?')
          ) {
            const expectedServiceId = values.at(-2);
            const expectedLeaseVersion = values.at(-1);
            const ownsLease =
              state.run.status === "running" &&
              state.run.serviceId === expectedServiceId &&
              state.run.leaseVersion === expectedLeaseVersion;
            if (!ownsLease) return { results: [], meta: { changes: 0 } };
            state.run.status = String(values[0]);
            state.run.completedAt = String(values[1]);
            state.run.completionKey = String(values[2]);
            state.run.error =
              typeof values[3] === "string" ? values[3] : null;
            return { results: [], meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE "runs"')) {
            const ownsLease =
              state.run.status === "running" &&
              state.run.serviceId === values[7] &&
              state.run.leaseVersion === values[8];
            if (!ownsLease) return { results: [], meta: { changes: 0 } };
            state.run.status = String(values[0]);
            state.run.usage = String(values[1]);
            state.run.output = typeof values[2] === "string" ? values[2] : null;
            state.run.error = typeof values[3] === "string" ? values[3] : null;
            state.run.completedAt = String(values[4]);
            state.run.completionKey = String(values[5]);
            return { results: [], meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO "messages"')) {
            const predicateSize = 5;
            const rowSize = 9;
            const rowCount = (values.length - predicateSize) / rowSize;
            for (let index = 0; index < rowCount; index++) {
              const offset = index * rowSize;
              state.messages.push({
                id: String(values[offset]),
                threadId: state.run.threadId,
                role: String(values[offset + 2]),
                content: String(values[offset + 3]),
                r2Key:
                  typeof values[offset + 4] === "string"
                    ? String(values[offset + 4])
                    : null,
                toolCalls:
                  typeof values[offset + 5] === "string"
                    ? String(values[offset + 5])
                    : null,
                toolCallId:
                  typeof values[offset + 6] === "string"
                    ? String(values[offset + 6])
                    : null,
                metadata: String(values[offset + 7]),
                sequence:
                  Math.max(-1, ...state.messages.map((row) => row.sequence)) +
                  1,
                createdAt: String(values[offset + 8]),
              });
            }
            return { results: [], meta: { changes: rowCount } };
          }
          if (sql.includes('INSERT INTO "run_events"')) {
            const id = state.runEvents.length + 1;
            state.runEvents.push({
              id,
              runId: state.run.id,
              type: String(values[0]),
              eventKey: String(values[1]),
              data: String(values[2]),
              createdAt: String(values[3]),
            });
            return { results: [{ id }], meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO "index_jobs"')) {
            const id = String(values[0]);
            const type = String(values[1]);
            const createdAt = String(values[2]);
            const matchesCommittedRun =
              values.includes(state.run.id) &&
              values.includes(state.run.status) &&
              values.includes(state.run.completionKey);
            if (
              !matchesCommittedRun ||
              state.indexJobs.some((job) => job.id === id)
            ) {
              return { results: [], meta: { changes: 0 } };
            }
            state.indexJobs.push({
              id,
              accountId: state.run.accountId,
              type,
              targetId:
                type === "thread_context" ? state.run.threadId : state.run.id,
              status: "queued",
              error: null,
              claimToken: null,
              startedAt: null,
              createdAt,
            });
            return { results: [], meta: { changes: 1 } };
          }
          if (sql.includes("INSERT INTO memory_claims")) {
            state.memoryClaims.push({
              id: String(values[0]),
              accountId: String(values[1]),
              claimType: String(values[2]),
              subject: String(values[3]),
              predicate: String(values[4]),
              object: String(values[5]),
              confidence: Number(values[6]),
              status: String(values[7]),
              sourceRunId: typeof values[9] === "string" ? values[9] : null,
            });
          }
          if (sql.includes("INSERT INTO memory_evidence")) {
            state.memoryEvidence.push({
              id: String(values[0]),
              accountId: String(values[1]),
              claimId: String(values[2]),
              kind: String(values[3]),
              sourceType: String(values[4]),
              sourceRef: typeof values[5] === "string" ? values[5] : null,
              content: String(values[6]),
            });
          }
          return { meta: { changes: 1 } };
        },
        all: async () => ({ results: [] }),
        first: async () => null,
        raw: async () => [],
      };
    },
  };
  return statement;
}

function tableName(table: unknown): string {
  try {
    return getTableName(table as never);
  } catch {
    return "";
  }
}
