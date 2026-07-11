import { test } from "bun:test";
import { assert, assertEquals } from "@takos/test/assert";
import { getTableName } from "drizzle-orm";
import { handleAddMessage, handleMemoryFinalize, handleRunEvent, handleUpdateRunStatus } from "../../container-hosts/executor-control-rpc.ts";
import { handleQueue } from "../queue-handler.ts";
import { RUN_QUEUE_MESSAGE_VERSION, type RunQueueMessage } from "../../../shared/types/index.ts";

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

type AgentProofState = {
  run: RunState;
  messages: MessageState[];
  runEvents: RunEventState[];
  memoryClaims: MemoryClaimState[];
  memoryEvidence: MemoryEvidenceState[];
  notifierPayloads: unknown[];
  indexMessages: unknown[];
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
      createdAt: "2026-06-02T00:00:00.000Z",
    },
    messages: [{
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
    }],
    runEvents: [],
    memoryClaims: [],
    memoryEvidence: [],
    notifierPayloads: [],
    indexMessages: [],
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

  await handleQueue({
    queue: "takos-runs",
    messages: [message],
  }, env as never);

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
    state.messages.filter((row) => row.role === "assistant").map((row) => row.content),
    ["Agent proof complete"],
  );
  assertEquals(state.memoryClaims.length, 1);
  assertEquals(state.memoryClaims[0].sourceRunId, state.run.id);
  assertEquals(state.memoryClaims[0].subject, "agent-proof");
  assertEquals(state.memoryEvidence.length, 1);
  assertEquals(state.memoryEvidence[0].sourceRef, state.run.id);
  assertEquals(
    state.runEvents.map((event) => event.type),
    ["started", "progress", "completed"],
  );
  assertEquals(state.notifierPayloads.length, 3);
  assertEquals(state.indexMessages.length, 1);
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
      createdAt: "2026-06-02T00:00:00.000Z",
    },
    messages: [],
    runEvents: [],
    memoryClaims: [],
    memoryEvidence: [],
    notifierPayloads: [],
    indexMessages: [],
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

  await handleQueue({
    queue: "takos-runs",
    messages: [message],
  }, env as never);

  assertEquals(message.acks, 0);
  assertEquals(message.retries, 1);
  assertEquals(state.run.status, "queued");
  assertEquals(state.run.serviceId, null);
  assertEquals(state.run.serviceHeartbeat, null);
  assertEquals(state.run.completedAt, null);
  assertEquals(
    state.run.error,
    "Dispatch exception: Error: Network connection lost",
  );
});

function createAgentProofEnv(
  state: AgentProofState,
  dispatches: Array<Record<string, unknown>>,
) {
  return {
    DB: createAgentProofDb(state),
    RUN_QUEUE: {},
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
        const body = await request.json() as Record<string, unknown>;
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

  assertResponseOk(await handleRunEvent({
    runId,
    type: "started",
    sequence: 1,
    data: { workerId: dispatch.workerId, model: dispatch.model },
  }, env as never));
  assertResponseOk(await handleRunEvent({
    runId,
    type: "progress",
    sequence: 2,
    data: { message: "agent container accepted run" },
  }, env as never));
  assertResponseOk(await handleAddMessage({
    runId,
    threadId: state.run.threadId,
    message: {
      role: "assistant",
      content: "Agent proof complete",
    },
    metadata: { idempotencyKey: "agent-proof-assistant" },
  }, env as never));
  assertResponseOk(await handleMemoryFinalize({
    runId,
    spaceId: state.run.accountId,
    claims: [{
      id: "claim_agent_proof",
      accountId: state.run.accountId,
      claimType: "fact",
      subject: "agent-proof",
      predicate: "status",
      object: "completed",
      confidence: 0.99,
      status: "active",
      sourceRunId: runId,
    }],
    evidence: [{
      id: "evidence_agent_proof",
      accountId: state.run.accountId,
      claimId: "claim_agent_proof",
      kind: "supports",
      sourceType: "agent_inference",
      sourceRef: runId,
      content: "Agent container completed the local proof run.",
      trust: 0.95,
    }],
  }, env as never));
  assertResponseOk(await handleUpdateRunStatus({
    runId,
    status: "completed",
    usage: { inputTokens: 12, outputTokens: 8 },
    output: "Agent proof complete",
  }, env as never));
  assertResponseOk(await handleRunEvent({
    runId,
    type: "completed",
    sequence: 3,
    data: { status: "completed" },
  }, env as never));
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
    ack() {
      this.acks += 1;
    },
    retry() {
      this.retries += 1;
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
  };
  return db;
}

function selectFirst(
  state: AgentProofState,
  table: string,
  fields?: Record<string, unknown>,
): Record<string, unknown> | null {
  if (table === "runs") {
    if (fields && "leaseVersion" in fields) {
      return { leaseVersion: state.run.leaseVersion };
    }
    return {
      status: state.run.status,
      usage: state.run.usage,
      output: state.run.output,
      error: state.run.error,
      accountId: state.run.accountId,
      threadId: state.run.threadId,
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
      toolCallId: typeof values.toolCallId === "string" ? values.toolCallId : null,
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
