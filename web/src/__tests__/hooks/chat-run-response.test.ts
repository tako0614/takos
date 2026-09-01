import { expect, test } from "bun:test";
import {
  parseChatRunCreateResponse,
  parseChatRunDetailResponse,
} from "../../hooks/chat-run-response.ts";

const expected = {
  runId: "run_request_" + "a".repeat(32),
  threadId: "thread-1",
  spaceId: "space-1",
};

function rawRun(overrides: Record<string, unknown> = {}) {
  return {
    id: expected.runId,
    thread_id: expected.threadId,
    space_id: expected.spaceId,
    session_id: null,
    parent_run_id: null,
    child_thread_id: null,
    root_thread_id: expected.threadId,
    root_run_id: expected.runId,
    agent_type: "default",
    model: "gpt-5.5",
    status: "queued",
    terminal_reason: null,
    input: '{"locale":"en"}',
    output: null,
    error: null,
    usage: "{}",
    worker_id: null,
    worker_heartbeat: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
    ...overrides,
  };
}

test("Chat Run create responses project only the current authority summary", () => {
  const result = parseChatRunCreateResponse(
    { run: rawRun(), reused: false },
    expected,
  );
  expect(result.reused).toBe(false);
  expect(result.run).toEqual({
    id: expected.runId,
    thread_id: expected.threadId,
    space_id: expected.spaceId,
    session_id: null,
    parent_run_id: null,
    child_thread_id: null,
    root_thread_id: expected.threadId,
    root_run_id: expected.runId,
    agent_type: "default",
    model: "gpt-5.5",
    status: "queued",
    terminal_reason: null,
    error: null,
    started_at: null,
    completed_at: null,
    created_at: "2026-08-10T00:00:00.000Z",
  });
  expect("input" in result.run).toBe(false);
  expect("output" in result.run).toBe(false);
  expect("usage" in result.run).toBe(false);
  expect("worker_id" in result.run).toBe(false);
});

test("Chat Run responses reject identity, authority, and hierarchy drift", () => {
  for (const run of [
    rawRun({ id: "run-other" }),
    rawRun({ thread_id: "thread-other" }),
    rawRun({ space_id: "space-other" }),
    rawRun({ root_thread_id: "thread-other" }),
    rawRun({ root_run_id: "run-other" }),
    rawRun({ parent_run_id: "run-parent" }),
  ]) {
    expect(() =>
      parseChatRunCreateResponse({ run, reused: false }, expected)
    ).toThrow();
  }
});

test("Chat Run responses reject ambiguous and incoherent success", () => {
  expect(() =>
    parseChatRunCreateResponse(
      { run: rawRun(), reused: false, extra: true },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseChatRunDetailResponse(
      { run: rawRun({ unexpected: true }) },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseChatRunDetailResponse(
      { run: rawRun({ status: "surprise" }) },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseChatRunDetailResponse(
      {
        run: rawRun({
          status: "completed",
          completed_at: null,
        }),
      },
      expected,
    )
  ).toThrow();
  expect(() =>
    parseChatRunDetailResponse(
      {
        run: rawRun({
          status: "running",
          started_at: "2026-08-09T00:00:00.000Z",
        }),
      },
      expected,
    )
  ).toThrow();
});

test("Chat Run detail responses accept the exact requested active Run", () => {
  const run = parseChatRunDetailResponse(
    {
      run: rawRun({
        status: "running",
        session_id: "session-1",
        worker_id: "worker-1",
        worker_heartbeat: "2026-08-10T00:00:02.000Z",
        started_at: "2026-08-10T00:00:01.000Z",
      }),
    },
    expected,
  );
  expect(run.id).toBe(expected.runId);
  expect(run.status).toBe("running");
  expect(run.session_id).toBe("session-1");
});
