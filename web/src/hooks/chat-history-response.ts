import {
  CHAT_HISTORY_TRUNCATED_EVENT_DATA,
  MAX_CHAT_HISTORY_ARTIFACTS,
  MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS,
  MAX_CHAT_HISTORY_EVENTS,
  MAX_CHAT_HISTORY_FIELD_CHARACTERS,
  MAX_CHAT_HISTORY_ID_CHARACTERS,
  MAX_CHAT_HISTORY_RUNS,
  MAX_CHAT_HISTORY_TEXT_CHARACTERS,
  MAX_CHAT_HISTORY_TIMESTAMP_CHARACTERS,
} from "takos-api-contract/chat-history";
import type { Message } from "../types/index.ts";
import type {
  ThreadHistoryArtifactSummary,
  ThreadHistoryChildRunSummary,
  ThreadHistoryEvent,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryRunSummary,
  ThreadHistoryTaskContext,
  ThreadHistoryTruncation,
} from "takos-api-contract/shared/types";
import { parseChatMessages } from "./chat-message-response.ts";

const RUN_STATUSES = new Set<ThreadHistoryRunSummary["status"]>([
  "pending",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
const ACTIVE_RUN_STATUSES = new Set<ThreadHistoryRunSummary["status"]>([
  "pending",
  "queued",
  "running",
]);
const ARTIFACT_TYPES = new Set([
  "code",
  "config",
  "doc",
  "patch",
  "report",
  "other",
]);
const TASK_STATUSES = new Set([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
  "failed",
]);
const TASK_PRIORITIES = new Set(["low", "medium", "high", "urgent"]);
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

type ParseBudget = {
  text: number;
  artifacts: number;
  events: number;
};

export type ChatHistoryResponse = {
  messages: Message[];
  total: number;
  limit: number;
  offset: number;
  runs: ThreadHistoryRunNode[];
  focus: ThreadHistoryFocus;
  activeRun: ThreadHistoryRunSummary | null;
  taskContext: ThreadHistoryTaskContext | null;
  truncation: ThreadHistoryTruncation;
};

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Invalid Chat history ${field}`);
  }
  return value as Record<string, unknown>;
}

function text(
  value: unknown,
  field: string,
  maximum: number,
  budget: ParseBudget,
  allowEmpty = false,
  allowWhitespace = false,
): string {
  const invalidControlPattern = allowWhitespace
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u
    : /[\u0000-\u001f\u007f]/u;
  if (
    typeof value !== "string" || value.length > maximum ||
    (!allowEmpty && value.length === 0) || invalidControlPattern.test(value)
  ) {
    throw new TypeError(`Invalid Chat history ${field}`);
  }
  budget.text += value.length;
  if (budget.text > MAX_CHAT_HISTORY_TEXT_CHARACTERS) {
    throw new TypeError("Chat history text budget exceeded");
  }
  return value;
}

function id(value: unknown, field: string, budget: ParseBudget): string {
  const parsed = text(
    value,
    field,
    MAX_CHAT_HISTORY_ID_CHARACTERS,
    budget,
  );
  if (!OPAQUE_ID_PATTERN.test(parsed)) {
    throw new TypeError(`Invalid Chat history ${field}`);
  }
  return parsed;
}

function nullableId(
  value: unknown,
  field: string,
  budget: ParseBudget,
): string | null {
  return value === null ? null : id(value, field, budget);
}

function timestamp(
  value: unknown,
  field: string,
  budget: ParseBudget,
): string {
  const parsed = text(
    value,
    field,
    MAX_CHAT_HISTORY_TIMESTAMP_CHARACTERS,
    budget,
  );
  if (!Number.isFinite(Date.parse(parsed))) {
    throw new TypeError(`Invalid Chat history ${field}`);
  }
  return parsed;
}

function nullableTimestamp(
  value: unknown,
  field: string,
  budget: ParseBudget,
): string | null {
  return value === null ? null : timestamp(value, field, budget);
}

function integer(value: unknown, field: string): number {
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 0
  ) {
    throw new TypeError(`Invalid Chat history ${field}`);
  }
  return value;
}

function status(value: unknown): ThreadHistoryRunSummary["status"] {
  if (!RUN_STATUSES.has(value as ThreadHistoryRunSummary["status"])) {
    throw new TypeError("Invalid Chat history Run status");
  }
  return value as ThreadHistoryRunSummary["status"];
}

function terminalReason(
  value: unknown,
): ThreadHistoryRunSummary["terminal_reason"] {
  if (
    value !== null && value !== "context_revoked" &&
    value !== "context_invalid"
  ) {
    throw new TypeError("Invalid Chat history Run terminal reason");
  }
  return value;
}

function jsonObjectText(
  value: unknown,
  field: string,
  maximum: number,
  budget: ParseBudget,
): string {
  const serialized = text(value, field, maximum, budget, true, true);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new TypeError(`Invalid Chat history ${field}`);
  }
  const root = record(parsed, field);
  const stack: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 0 },
  ];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodes++;
    if (nodes > 4_096 || current.depth > 32) {
      throw new TypeError(`Invalid Chat history ${field}`);
    }
    if (typeof current.value !== "object" || current.value === null) continue;
    const values = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>);
    for (const child of values) {
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return serialized;
}

function parseRun(
  value: unknown,
  expectedSpaceId: string,
  budget: ParseBudget,
): ThreadHistoryRunSummary {
  const candidate = record(value, "Run");
  for (
    const forbidden of [
      "input",
      "output",
      "error",
      "usage",
      "worker_id",
      "worker_heartbeat",
    ]
  ) {
    if (forbidden in candidate) {
      throw new TypeError("Unexpected Chat history Run execution data");
    }
  }
  const spaceId = id(candidate.space_id, "Run Workspace id", budget);
  if (spaceId !== expectedSpaceId) {
    throw new TypeError("Mismatched Chat history Run Workspace");
  }
  const model = candidate.model === null
    ? null
    : text(candidate.model, "Run model", 128, budget);
  return {
    id: id(candidate.id, "Run id", budget),
    thread_id: id(candidate.thread_id, "Run Thread id", budget),
    space_id: spaceId,
    session_id: nullableId(candidate.session_id, "Run session id", budget),
    parent_run_id: nullableId(
      candidate.parent_run_id,
      "Run parent id",
      budget,
    ),
    child_thread_id: nullableId(
      candidate.child_thread_id,
      "Run child Thread id",
      budget,
    ),
    root_thread_id: id(
      candidate.root_thread_id,
      "Run root Thread id",
      budget,
    ),
    root_run_id: nullableId(candidate.root_run_id, "Run root id", budget),
    agent_type: text(
      candidate.agent_type,
      "Run agent type",
      MAX_CHAT_HISTORY_FIELD_CHARACTERS,
      budget,
    ),
    model,
    status: status(candidate.status),
    terminal_reason: terminalReason(candidate.terminal_reason),
    started_at: nullableTimestamp(
      candidate.started_at,
      "Run started_at",
      budget,
    ),
    completed_at: nullableTimestamp(
      candidate.completed_at,
      "Run completed_at",
      budget,
    ),
    created_at: timestamp(candidate.created_at, "Run created_at", budget),
  };
}

function parseArtifact(
  value: unknown,
  runId: string,
  budget: ParseBudget,
): ThreadHistoryArtifactSummary {
  budget.artifacts++;
  if (budget.artifacts > MAX_CHAT_HISTORY_ARTIFACTS) {
    throw new TypeError("Chat history artifact budget exceeded");
  }
  const candidate = record(value, "artifact");
  const actualRunId = id(candidate.run_id, "artifact Run id", budget);
  if (actualRunId !== runId || !ARTIFACT_TYPES.has(candidate.type as string)) {
    throw new TypeError("Mismatched Chat history artifact");
  }
  return {
    id: id(candidate.id, "artifact id", budget),
    run_id: actualRunId,
    type: candidate.type as ThreadHistoryArtifactSummary["type"],
    title: candidate.title === null
      ? null
      : text(
        candidate.title,
        "artifact title",
        MAX_CHAT_HISTORY_FIELD_CHARACTERS,
        budget,
        true,
        true,
      ),
    file_id: nullableId(candidate.file_id, "artifact file id", budget),
    created_at: timestamp(
      candidate.created_at,
      "artifact created_at",
      budget,
    ),
  };
}

function parseEvent(
  value: unknown,
  runId: string,
  budget: ParseBudget,
): ThreadHistoryEvent {
  budget.events++;
  if (budget.events > MAX_CHAT_HISTORY_EVENTS) {
    throw new TypeError("Chat history event budget exceeded");
  }
  const candidate = record(value, "event");
  const actualRunId = id(candidate.run_id, "event Run id", budget);
  if (actualRunId !== runId) {
    throw new TypeError("Mismatched Chat history event");
  }
  if (typeof candidate.data_truncated !== "boolean") {
    throw new TypeError("Invalid Chat history event truncation marker");
  }
  const data = candidate.data_truncated
    ? text(
      candidate.data,
      "event data",
      MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS,
      budget,
      false,
      true,
    )
    : jsonObjectText(
      candidate.data,
      "event data",
      MAX_CHAT_HISTORY_EVENT_DATA_CHARACTERS,
      budget,
    );
  if (candidate.data_truncated && data !== CHAT_HISTORY_TRUNCATED_EVENT_DATA) {
    throw new TypeError("Invalid Chat history truncated event data");
  }
  return {
    id: integer(candidate.id, "event id"),
    run_id: actualRunId,
    type: text(
      candidate.type,
      "event type",
      MAX_CHAT_HISTORY_FIELD_CHARACTERS,
      budget,
    ),
    data,
    data_truncated: candidate.data_truncated,
    created_at: timestamp(candidate.created_at, "event created_at", budget),
  };
}

function parseTruncation(value: unknown): ThreadHistoryTruncation {
  const candidate = record(value, "truncation");
  if (Object.keys(candidate).length !== 5) {
    throw new TypeError("Invalid Chat history truncation");
  }
  for (
    const key of [
      "message_data",
      "runs",
      "artifacts",
      "events",
      "event_data",
    ] as const
  ) {
    if (typeof candidate[key] !== "boolean") {
      throw new TypeError("Invalid Chat history truncation");
    }
  }
  return {
    message_data: candidate.message_data as boolean,
    runs: candidate.runs as boolean,
    artifacts: candidate.artifacts as boolean,
    events: candidate.events as boolean,
    event_data: candidate.event_data as boolean,
  };
}

function parseChildRun(
  value: unknown,
  runId: string,
  budget: ParseBudget,
): ThreadHistoryChildRunSummary {
  const candidate = record(value, "child Run");
  const childRunId = id(candidate.run_id, "child Run id", budget);
  if (childRunId === runId) {
    throw new TypeError("Invalid Chat history child Run identity");
  }
  return {
    run_id: childRunId,
    thread_id: id(candidate.thread_id, "child Run Thread id", budget),
    child_thread_id: nullableId(
      candidate.child_thread_id,
      "child Run child Thread id",
      budget,
    ),
    status: status(candidate.status),
    agent_type: text(
      candidate.agent_type,
      "child Run agent type",
      MAX_CHAT_HISTORY_FIELD_CHARACTERS,
      budget,
    ),
    created_at: timestamp(
      candidate.created_at,
      "child Run created_at",
      budget,
    ),
    completed_at: nullableTimestamp(
      candidate.completed_at,
      "child Run completed_at",
      budget,
    ),
  };
}

function parseRunNode(
  value: unknown,
  expectedSpaceId: string,
  budget: ParseBudget,
): ThreadHistoryRunNode {
  const candidate = record(value, "Run node");
  const run = parseRun(candidate.run, expectedSpaceId, budget);
  if (!Array.isArray(candidate.artifacts) || !Array.isArray(candidate.events)) {
    throw new TypeError("Invalid Chat history Run collections");
  }
  const artifacts = candidate.artifacts.map((artifact) =>
    parseArtifact(artifact, run.id, budget)
  );
  const events = candidate.events.map((event) =>
    parseEvent(event, run.id, budget)
  );
  const eventIds = events.map((event) => event.id);
  if (
    new Set(artifacts.map((artifact) => artifact.id)).size !==
      artifacts.length ||
    new Set(eventIds).size !== eventIds.length ||
    eventIds.some((eventId, index) => index > 0 && eventId <= eventIds[index - 1])
  ) {
    throw new TypeError("Duplicate or unordered Chat history Run collection");
  }
  if (!Array.isArray(candidate.child_runs)) {
    throw new TypeError("Invalid Chat history child Runs");
  }
  const childRuns = candidate.child_runs.map((child) =>
    parseChildRun(child, run.id, budget)
  );
  if (
    integer(candidate.artifact_count, "artifact_count") !== artifacts.length ||
    integer(candidate.child_run_count, "child_run_count") !== childRuns.length ||
    new Set(childRuns.map((child) => child.run_id)).size !== childRuns.length
  ) {
    throw new TypeError("Mismatched Chat history Run counts");
  }
  const latestEventAt = timestamp(
    candidate.latest_event_at,
    "latest_event_at",
    budget,
  );
  const expectedLatestEventAt = events[events.length - 1]?.created_at ??
    run.completed_at ?? run.started_at ?? run.created_at;
  if (latestEventAt !== expectedLatestEventAt) {
    throw new TypeError("Mismatched Chat history latest event");
  }
  return {
    run,
    artifact_count: artifacts.length,
    latest_event_at: latestEventAt,
    artifacts,
    events,
    child_thread_id: nullableId(
      candidate.child_thread_id,
      "node child Thread id",
      budget,
    ),
    child_run_count: childRuns.length,
    child_runs: childRuns,
  };
}

function parseFocus(
  value: unknown,
  nodes: ThreadHistoryRunNode[],
  budget: ParseBudget,
): ThreadHistoryFocus {
  const candidate = record(value, "focus");
  const newest = nodes.slice().reverse();
  const latest = newest[0]?.run.id ?? null;
  const active = newest.find((node) => ACTIVE_RUN_STATUSES.has(node.run.status))
    ?.run.id ?? null;
  const failed = newest.find((node) => node.run.status === "failed")?.run.id ??
    null;
  const completed = newest.find((node) => node.run.status === "completed")?.run
    .id ?? null;
  const focus: ThreadHistoryFocus = {
    latest_run_id: nullableId(candidate.latest_run_id, "latest Run id", budget),
    latest_active_run_id: nullableId(
      candidate.latest_active_run_id,
      "latest active Run id",
      budget,
    ),
    latest_failed_run_id: nullableId(
      candidate.latest_failed_run_id,
      "latest failed Run id",
      budget,
    ),
    latest_completed_run_id: nullableId(
      candidate.latest_completed_run_id,
      "latest completed Run id",
      budget,
    ),
    resume_run_id: nullableId(candidate.resume_run_id, "resume Run id", budget),
  };
  if (
    focus.latest_run_id !== latest || focus.latest_active_run_id !== active ||
    focus.latest_failed_run_id !== failed ||
    focus.latest_completed_run_id !== completed ||
    focus.resume_run_id !== (active ?? failed ?? latest)
  ) {
    throw new TypeError("Mismatched Chat history focus");
  }
  return focus;
}

function parseTaskContext(
  value: unknown,
  expected: { spaceId: string; threadId: string },
  budget: ParseBudget,
): ThreadHistoryTaskContext | null {
  if (value === null) return null;
  const candidate = record(value, "Task context");
  const spaceId = id(candidate.space_id, "Task Workspace id", budget);
  const threadId = id(candidate.thread_id, "Task Thread id", budget);
  if (
    spaceId !== expected.spaceId || threadId !== expected.threadId ||
    !TASK_STATUSES.has(candidate.status as string) ||
    !TASK_PRIORITIES.has(candidate.priority as string)
  ) {
    throw new TypeError("Mismatched Chat history Task context");
  }
  return {
    id: id(candidate.id, "Task id", budget),
    space_id: spaceId,
    thread_id: threadId,
    title: text(
      candidate.title,
      "Task title",
      MAX_CHAT_HISTORY_FIELD_CHARACTERS,
      budget,
    ),
    status: candidate.status as ThreadHistoryTaskContext["status"],
    priority: candidate.priority as ThreadHistoryTaskContext["priority"],
  };
}

function sameRun(
  left: ThreadHistoryRunSummary,
  right: ThreadHistoryRunSummary,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function parseChatHistoryResponse(
  value: unknown,
  expected: {
    spaceId: string;
    threadId: string;
    limit: number;
    offset: number;
    includeMessages: boolean;
    rootRunId?: string | null;
    latest?: boolean;
  },
): ChatHistoryResponse {
  const candidate = record(value, "response");
  if (
    candidate.limit !== expected.limit ||
    !Array.isArray(candidate.runs) ||
    candidate.runs.length > MAX_CHAT_HISTORY_RUNS
  ) {
    throw new TypeError("Invalid Chat history response page");
  }
  const budget: ParseBudget = { text: 0, artifacts: 0, events: 0 };
  const messages = parseChatMessages(candidate.messages, expected.threadId);
  for (const message of messages) {
    budget.text += message.content.length + message.metadata.length +
      (message.tool_calls?.length ?? 0);
  }
  if (budget.text > MAX_CHAT_HISTORY_TEXT_CHARACTERS) {
    throw new TypeError("Chat history text budget exceeded");
  }
  const total = integer(candidate.total, "message total");
  const offset = integer(candidate.offset, "message offset");
  const expectedOffset = expected.latest
    ? Math.max(0, total - expected.limit)
    : expected.offset;
  if (
    messages.length > expected.limit || total < messages.length ||
    offset !== expectedOffset ||
    (!expected.includeMessages && (messages.length !== 0 || total !== 0))
  ) {
    throw new TypeError("Mismatched Chat history message page");
  }
  const nodes = candidate.runs.map((node) =>
    parseRunNode(node, expected.spaceId, budget)
  );
  const runIds = nodes.map((node) => node.run.id);
  const runIdSet = new Set(runIds);
  if (
    runIdSet.size !== runIds.length ||
    (expected.rootRunId && nodes.length > 0 && !runIdSet.has(expected.rootRunId))
  ) {
    throw new TypeError("Duplicate or mismatched Chat history Run identity");
  }
  const runsById = new Map(nodes.map((node) => [node.run.id, node.run]));
  for (let index = 1; index < nodes.length; index++) {
    const previous = nodes[index - 1].run;
    const current = nodes[index].run;
    const previousTime = Date.parse(previous.created_at);
    const currentTime = Date.parse(current.created_at);
    if (
      currentTime < previousTime ||
      (currentTime === previousTime && current.id < previous.id)
    ) {
      throw new TypeError("Unordered Chat history Runs");
    }
  }
  for (const node of nodes) {
    const run = node.run;
    if (!run.parent_run_id) {
      if (run.root_run_id !== run.id || run.root_thread_id !== run.thread_id) {
        throw new TypeError("Mismatched Chat history Run root");
      }
    } else {
      const parent = runsById.get(run.parent_run_id);
      if (
        parent &&
        (run.root_run_id !== parent.root_run_id ||
          run.root_thread_id !== parent.root_thread_id)
      ) {
        throw new TypeError("Mismatched Chat history Run root");
      }
      const visited = new Set([run.id]);
      let cursor: ThreadHistoryRunSummary | undefined = run;
      while (cursor.parent_run_id) {
        if (visited.has(cursor.parent_run_id)) {
          throw new TypeError("Cyclic Chat history Run tree");
        }
        visited.add(cursor.parent_run_id);
        cursor = runsById.get(cursor.parent_run_id);
        if (!cursor) break;
      }
    }
    for (const child of node.child_runs) {
      const childRun = runsById.get(child.run_id);
      if (
        !childRun || childRun.parent_run_id !== node.run.id ||
        childRun.thread_id !== child.thread_id ||
        childRun.child_thread_id !== child.child_thread_id ||
        childRun.status !== child.status ||
        childRun.agent_type !== child.agent_type ||
        childRun.created_at !== child.created_at ||
        childRun.completed_at !== child.completed_at
      ) {
        throw new TypeError("Mismatched Chat history child Run projection");
      }
    }
    const childThreadIds = Array.from(
      new Set(
        node.child_runs.flatMap((child) =>
          child.child_thread_id ? [child.child_thread_id] : []
        ),
      ),
    );
    const expectedChildThreadId = childThreadIds.length === 1
      ? childThreadIds[0]
      : null;
    if (node.child_thread_id !== expectedChildThreadId) {
      throw new TypeError("Mismatched Chat history child Thread projection");
    }
  }
  const focus = parseFocus(candidate.focus, nodes, budget);
  const activeRun = candidate.activeRun === null
    ? null
    : parseRun(candidate.activeRun, expected.spaceId, budget);
  const expectedActiveRun = nodes.slice().reverse().find((node) =>
    ACTIVE_RUN_STATUSES.has(node.run.status)
  )?.run ?? null;
  if (
    (activeRun === null) !== (expectedActiveRun === null) ||
    (activeRun && expectedActiveRun && !sameRun(activeRun, expectedActiveRun))
  ) {
    throw new TypeError("Mismatched Chat history active Run");
  }
  const truncation = parseTruncation(candidate.truncation);
  const hasTruncatedEventData = nodes.some((node) =>
    node.events.some((event) => event.data_truncated)
  );
  if (truncation.event_data !== hasTruncatedEventData) {
    throw new TypeError("Mismatched Chat history event data truncation");
  }
  return {
    messages,
    total,
    limit: expected.limit,
    offset,
    runs: nodes,
    focus,
    activeRun,
    taskContext: parseTaskContext(candidate.taskContext, expected, budget),
    truncation,
  };
}
