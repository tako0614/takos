import { expect, test } from "bun:test";
import { parseChatHistoryResponse } from "../../hooks/chat-history-response.ts";
import type {
  ThreadHistoryRunNode,
  ThreadHistoryRunSummary,
} from "takos-api-contract/shared/types";

function run(
  overrides: Partial<ThreadHistoryRunSummary> = {},
): ThreadHistoryRunSummary {
  return {
    id: "run_1",
    thread_id: "thread_1",
    space_id: "space_1",
    session_id: null,
    parent_run_id: null,
    child_thread_id: null,
    root_thread_id: "thread_1",
    root_run_id: "run_1",
    agent_type: "default",
    model: "gpt-5.5",
    status: "running",
    terminal_reason: null,
    started_at: "2026-08-10T00:00:01.000Z",
    completed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

function node(
  currentRun: ThreadHistoryRunSummary = run(),
  overrides: Partial<ThreadHistoryRunNode> = {},
): ThreadHistoryRunNode {
  return {
    run: currentRun,
    artifact_count: 1,
    latest_event_at: "2026-08-10T00:00:02.000Z",
    artifacts: [{
      id: "artifact_1",
      run_id: currentRun.id,
      type: "report",
      title: "Result",
      file_id: null,
      created_at: "2026-08-10T00:00:02.000Z",
    }],
    events: [{
      id: 1,
      run_id: currentRun.id,
      type: "progress",
      data: '{"message":"working"}',
      data_truncated: false,
      created_at: "2026-08-10T00:00:02.000Z",
    }],
    child_thread_id: null,
    child_run_count: 0,
    child_runs: [],
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  const activeRun = run();
  return {
    messages: [],
    total: 0,
    limit: 100,
    offset: 0,
    runs: [node(activeRun)],
    focus: {
      latest_run_id: activeRun.id,
      latest_active_run_id: activeRun.id,
      latest_failed_run_id: null,
      latest_completed_run_id: null,
      resume_run_id: activeRun.id,
    },
    activeRun,
    taskContext: {
      id: "task_1",
      space_id: "space_1",
      thread_id: "thread_1",
      title: "Recover the request",
      status: "failed",
      priority: "high",
    },
    truncation: {
      message_data: false,
      runs: false,
      artifacts: false,
      events: false,
      event_data: false,
    },
    ...overrides,
  };
}

const expected = {
  spaceId: "space_1",
  threadId: "thread_1",
  limit: 100,
  offset: 0,
  includeMessages: true,
};

test("Chat history accepts one exact bounded Run tree and failed Task context", () => {
  const parsed = parseChatHistoryResponse(response(), expected);
  expect(parsed.runs).toHaveLength(1);
  expect(parsed.activeRun?.id).toBe("run_1");
  expect(parsed.taskContext).toEqual({
    id: "task_1",
    space_id: "space_1",
    thread_id: "thread_1",
    title: "Recover the request",
    status: "failed",
    priority: "high",
  });
});

test("Chat history rejects Workspace, focus, active Run, and Task identity drift", () => {
  const crossSpace = response();
  (crossSpace.runs as ThreadHistoryRunNode[])[0].run.space_id = "space_other";
  expect(() => parseChatHistoryResponse(crossSpace, expected)).toThrow(
    "Workspace",
  );

  const forgedFocus = response({
    focus: {
      latest_run_id: "run_1",
      latest_active_run_id: null,
      latest_failed_run_id: null,
      latest_completed_run_id: null,
      resume_run_id: "run_1",
    },
  });
  expect(() => parseChatHistoryResponse(forgedFocus, expected)).toThrow(
    "focus",
  );

  const forgedActive = response({ activeRun: run({ id: "run_other" }) });
  expect(() => parseChatHistoryResponse(forgedActive, expected)).toThrow(
    "active Run",
  );

  const forgedTask = response();
  (forgedTask.taskContext as Record<string, unknown>).thread_id = "thread_2";
  expect(() => parseChatHistoryResponse(forgedTask, expected)).toThrow(
    "Task context",
  );
});

test("Chat history rejects execution payloads outside its minimal Run projection", () => {
  const leaked = response();
  ((leaked.runs as ThreadHistoryRunNode[])[0].run as unknown as Record<
    string,
    unknown
  >).input =
    '{"secret":"must-not-cross-history"}';
  expect(() => parseChatHistoryResponse(leaked, expected)).toThrow(
    "Run execution data",
  );
});

test("Chat history rejects malformed event and child Run projections", () => {
  const malformedEvent = response();
  (malformedEvent.runs as ThreadHistoryRunNode[])[0].events[0].data = "[]";
  expect(() => parseChatHistoryResponse(malformedEvent, expected)).toThrow(
    "event data",
  );

  const parent = run({
    id: "run_parent",
    root_run_id: "run_parent",
    status: "completed",
  });
  const child = run({
    id: "run_child",
    thread_id: "thread_child",
    parent_run_id: parent.id,
    root_run_id: parent.id,
    status: "running",
    created_at: "2026-08-10T00:00:01.000Z",
  });
  const parentNode = node(parent, {
    child_thread_id: "thread_child",
    child_run_count: 1,
    child_runs: [{
      run_id: child.id,
      thread_id: child.thread_id,
      child_thread_id: "thread_child",
      status: "failed",
      agent_type: child.agent_type,
      created_at: child.created_at,
      completed_at: child.completed_at,
    }],
  });
  const childNode = node(child, {
    artifacts: [],
    artifact_count: 0,
    events: [],
    latest_event_at: child.created_at,
  });
  const forgedChild = response({
    runs: [parentNode, childNode],
    focus: {
      latest_run_id: child.id,
      latest_active_run_id: child.id,
      latest_failed_run_id: null,
      latest_completed_run_id: parent.id,
      resume_run_id: child.id,
    },
    activeRun: child,
  });
  expect(() => parseChatHistoryResponse(forgedChild, expected)).toThrow(
    "child Run projection",
  );

  const forgedRoot = response();
  (forgedRoot.runs as ThreadHistoryRunNode[])[0].run.root_run_id = "run_other";
  expect(() => parseChatHistoryResponse(forgedRoot, expected)).toThrow(
    "Run root",
  );
});

test("Chat history accepts only explicit canonical truncation evidence", () => {
  const messageTruncated = response({
    truncation: {
      message_data: true,
      runs: false,
      artifacts: false,
      events: false,
      event_data: false,
    },
  });
  expect(parseChatHistoryResponse(messageTruncated, expected).truncation)
    .toMatchObject({ message_data: true });

  const truncated = response({
    truncation: {
      message_data: false,
      runs: false,
      artifacts: false,
      events: false,
      event_data: true,
    },
  });
  const event = (truncated.runs as ThreadHistoryRunNode[])[0].events[0];
  event.data = '{"_takos_history":"event_data_truncated"}';
  event.data_truncated = true;
  expect(parseChatHistoryResponse(truncated, expected).truncation.event_data)
    .toBe(true);

  event.data = '{"message":"forged omission"}';
  expect(() => parseChatHistoryResponse(truncated, expected)).toThrow(
    "truncated event data",
  );

  const forgedMarker = response({
    truncation: {
      message_data: false,
      runs: false,
      artifacts: false,
      events: false,
      event_data: true,
    },
  });
  expect(() => parseChatHistoryResponse(forgedMarker, expected)).toThrow(
    "event data truncation",
  );

  const missing = response({ truncation: undefined });
  expect(() => parseChatHistoryResponse(missing, expected)).toThrow(
    "truncation",
  );
});

test("Chat history fences pagination and root-tree requests", () => {
  expect(() =>
    parseChatHistoryResponse(response({ limit: 200 }), expected)
  ).toThrow("page");
  expect(() =>
    parseChatHistoryResponse(response(), {
      ...expected,
      rootRunId: "run_other",
    })
  ).toThrow("Run identity");
  expect(() =>
    parseChatHistoryResponse(response({ messages: [], total: 1 }), {
      ...expected,
      includeMessages: false,
    })
  ).toThrow("message page");

  expect(parseChatHistoryResponse(response({
    messages: [],
    total: 250,
    offset: 150,
  }), {
    ...expected,
    latest: true,
  }).offset).toBe(150);
  expect(() =>
    parseChatHistoryResponse(response({
      messages: [],
      total: 250,
      offset: 0,
    }), {
      ...expected,
      latest: true,
    })
  ).toThrow("message page");
});
