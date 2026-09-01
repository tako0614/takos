import { expect, test } from "bun:test";
import { readTaskStartResponse } from "../../../views/agent/work/task-start-response.ts";

test("task start response accepts the matching execution target", () => {
  expect(readTaskStartResponse({
    task_id: "task_1",
    thread_id: "thread_1",
    run_id: "run_1",
    reused: false,
  }, "task_1")).toEqual({
    taskId: "task_1",
    threadId: "thread_1",
    runId: "run_1",
    reused: false,
  });
});

test("task start response rejects cross-task and malformed targets", () => {
  expect(() =>
    readTaskStartResponse({
      task_id: "task_other",
      thread_id: "thread_1",
      run_id: "run_1",
      reused: false,
    }, "task_1")
  ).toThrow();
  expect(() =>
    readTaskStartResponse({
      task_id: "task_1",
      thread_id: "",
      run_id: "run_1",
      reused: "false",
    }, "task_1")
  ).toThrow();
});
