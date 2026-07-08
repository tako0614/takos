import {
  createMobileApiClient,
  mobileRecord,
  mobileOptionalText,
  type FetchLike,
  type MobileSession,
} from "@takosjp/takosumi-mobile-kit";
import type { TakosMobileAgentTaskPreview } from "./home.ts";

export type TakosMobileAgentTaskPriority = "low" | "medium" | "high" | "urgent";
export type TakosMobileAgentTaskStatus =
  "planned" | "in_progress" | "blocked" | "completed" | "failed" | "cancelled";

export interface CreateTakosMobileAgentTaskInput {
  readonly session: MobileSession;
  readonly spaceId: string;
  readonly title: string;
  readonly description?: string;
  readonly priority?: TakosMobileAgentTaskPriority;
  readonly createThread?: boolean;
  readonly fetch?: FetchLike;
}

export interface UpdateTakosMobileAgentTaskStatusInput {
  readonly session: MobileSession;
  readonly taskId: string;
  readonly status: TakosMobileAgentTaskStatus;
  readonly fetch?: FetchLike;
}

const validTaskStatuses = new Set<TakosMobileAgentTaskStatus>([
  "planned",
  "in_progress",
  "blocked",
  "completed",
  "failed",
  "cancelled",
]);

export async function createTakosMobileAgentTask(
  input: CreateTakosMobileAgentTaskInput,
): Promise<TakosMobileAgentTaskPreview> {
  const spaceId = input.spaceId.trim();
  if (!spaceId) {
    throw new Error("Workspace is required.");
  }
  const title = input.title.trim();
  if (!title) {
    throw new Error("Task title is required.");
  }
  if (title.length > 240) {
    throw new Error("Task title is too long.");
  }
  const description = input.description?.trim();
  if (description && description.length > 4000) {
    throw new Error("Task description is too long.");
  }

  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<CreateTaskResponse>(
    `/api/spaces/${encodeURIComponent(spaceId)}/agent-tasks`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title,
        description,
        priority: input.priority ?? "medium",
        status: "planned",
        create_thread: input.createThread ?? true,
      }),
    },
  );
  const task = summarizeCreatedTask(response.task, spaceId);
  if (!task) {
    throw new Error("Host did not return an agent task.");
  }
  return task;
}

export async function updateTakosMobileAgentTaskStatus(
  input: UpdateTakosMobileAgentTaskStatusInput,
): Promise<TakosMobileAgentTaskPreview> {
  const taskId = input.taskId.trim();
  if (!taskId) {
    throw new Error("Task id is required.");
  }
  if (!validTaskStatuses.has(input.status)) {
    throw new Error("Task status is invalid.");
  }
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<CreateTaskResponse>(
    `/api/agent-tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ status: input.status }),
    },
  );
  const task = summarizeTaskResponse(response.task);
  if (!task) {
    throw new Error("Host did not return an agent task.");
  }
  return task;
}

interface CreateTaskResponse {
  readonly task?: unknown;
}

function summarizeCreatedTask(
  task: unknown,
  spaceId: string,
): TakosMobileAgentTaskPreview | undefined {
  if (!task || typeof task !== "object") return undefined;
  const record = task as Record<string, unknown>;
  return summarizeTaskRecord(record, spaceId);
}

function summarizeTaskResponse(
  task: unknown,
): TakosMobileAgentTaskPreview | undefined {
  if (!task || typeof task !== "object") return undefined;
  const record = task as Record<string, unknown>;
  return summarizeTaskRecord(
    record,
    mobileOptionalText(record.space_id) ?? "me",
  );
}

function summarizeTaskRecord(
  record: Record<string, unknown>,
  spaceId: string,
): TakosMobileAgentTaskPreview | undefined {
  const id = mobileOptionalText(record.id);
  const title = mobileOptionalText(record.title);
  if (!id || !title) return undefined;
  const resumeTarget = mobileRecord(record.resume_target);
  const threadId =
    mobileOptionalText(resumeTarget?.thread_id) ??
    mobileOptionalText(record.thread_id);
  const latestRun = mobileRecord(record.latest_run);
  return {
    id,
    title,
    description: mobileOptionalText(record.description)?.slice(0, 160),
    status: mobileOptionalText(record.status),
    priority: mobileOptionalText(record.priority),
    threadTitle: mobileOptionalText(record.thread_title),
    latestRunStatus: mobileOptionalText(latestRun?.status),
    updatedAt:
      mobileOptionalText(record.updated_at) ??
      mobileOptionalText(record.created_at),
    routePath: threadId
      ? `/chat/${encodeURIComponent(spaceId)}/${encodeURIComponent(threadId)}`
      : "/chat",
  };
}
