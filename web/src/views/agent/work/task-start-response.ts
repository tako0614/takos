function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readId(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`Invalid task start ${field}`);
  }
  return value;
}

export function readTaskStartResponse(value: unknown, expectedTaskId: string) {
  if (!isRecord(value)) throw new TypeError("Invalid task start response");
  const taskId = readId(value.task_id, "task_id");
  if (taskId !== expectedTaskId) {
    throw new TypeError("Task start response does not match the request");
  }
  if (typeof value.reused !== "boolean") {
    throw new TypeError("Invalid task start reused flag");
  }
  return {
    taskId,
    threadId: readId(value.thread_id, "thread_id"),
    runId: readId(value.run_id, "run_id"),
    reused: value.reused,
  };
}
