import {
  createMobileApiClient,
  isMobileAbortError,
  mobileNumber,
  mobileOptionalText,
  mobileRecord,
  hostEndpoint,
  type FetchLike,
  type MobileSession,
} from "@takosjp/takosumi-mobile-kit";

export const DEFAULT_TAKOS_MOBILE_MODEL = "gpt-5.5";

export interface LoadTakosMobileThreadMessagesInput {
  readonly session: MobileSession;
  readonly threadId: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly latest?: boolean;
  readonly fetch?: FetchLike;
}

export interface LoadTakosMobileThreadTranscriptInput {
  readonly session: MobileSession;
  readonly threadId: string;
  readonly limit?: number;
  readonly fetch?: FetchLike;
}

export interface TakosMobileThreadMessagesPage {
  readonly messages: readonly TakosMobileThreadMessagePreview[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasOlder: boolean;
  readonly nextOlderOffset?: number;
}

export interface TakosMobileThreadMessagePreview {
  readonly id?: string;
  readonly sequence?: number;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt?: string;
}

export interface CreateTakosMobileChatMessageInput {
  readonly session: MobileSession;
  readonly content: string;
  readonly spaceId?: string;
  readonly threadId?: string;
  readonly locale?: "ja" | "en";
  readonly model?: string;
  readonly fetch?: FetchLike;
}

export interface CreateTakosMobileChatMessageResult {
  readonly spaceId: string;
  readonly threadId: string;
  readonly routePath: string;
  readonly messageId?: string;
  readonly runId?: string;
}

export type TakosMobileRunStatus =
  "pending" | "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TakosMobileRunSummary {
  readonly id: string;
  readonly threadId?: string;
  readonly status: TakosMobileRunStatus;
  readonly output?: string;
  readonly error?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly createdAt?: string;
}

export interface LoadTakosMobileRunStatusInput {
  readonly session: MobileSession;
  readonly runId: string;
  readonly fetch?: FetchLike;
}

export interface CancelTakosMobileRunInput {
  readonly session: MobileSession;
  readonly runId: string;
  readonly fetch?: FetchLike;
}

export interface LoadTakosMobileRunEventsInput {
  readonly session: MobileSession;
  readonly runId: string;
  readonly lastEventId?: number;
  readonly fetch?: FetchLike;
}

export interface WatchTakosMobileRunEventStreamInput extends LoadTakosMobileRunEventsInput {
  readonly signal?: AbortSignal;
  readonly onEvent?: (event: TakosMobileRunEvent) => void | Promise<void>;
}

export interface TakosMobileRunEvent {
  readonly id: number;
  readonly eventId: string;
  readonly runId: string;
  readonly type: string;
  readonly data?: string;
  readonly status?: TakosMobileRunStatus;
  readonly messageRole?: TakosMobileRunEventMessageRole;
  readonly messageText?: string;
  readonly assistantText?: string;
  readonly createdAt?: string;
}

export type TakosMobileRunEventMessageRole =
  "assistant" | "user" | "system" | "tool";

export interface TakosMobileRunEventsPage {
  readonly events: readonly TakosMobileRunEvent[];
  readonly runStatus: TakosMobileRunStatus;
  readonly lastEventId: number;
}

export interface TakosMobileRunEventStreamResult {
  readonly events: readonly TakosMobileRunEvent[];
  readonly lastEventId: number;
  readonly terminalStatus?: TakosMobileRunStatus;
  readonly aborted: boolean;
}

const defaultThreadMessageLimit = 8;
const defaultTranscriptMessageLimit = 20;
const maxThreadMessageLimit = 50;
const terminalRunStatuses = new Set<TakosMobileRunStatus>([
  "completed",
  "failed",
  "cancelled",
]);

export async function loadTakosMobileThreadMessages(
  input: LoadTakosMobileThreadMessagesInput,
): Promise<TakosMobileThreadMessagesPage> {
  const threadId = input.threadId.trim();
  if (!threadId) {
    throw new Error("Thread id is required.");
  }
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const limit = normalizeMessageLimit(input.limit);
  const offset = normalizeMessageOffset(input.offset);
  const firstPage = await loadThreadMessagePage(client.json, {
    threadId,
    limit,
    offset,
  });
  if (!input.latest) return firstPage;
  const latestOffset = Math.max(0, firstPage.total - limit);
  if (latestOffset === firstPage.offset) return firstPage;
  return await loadThreadMessagePage(client.json, {
    threadId,
    limit,
    offset: latestOffset,
  });
}

export async function loadTakosMobileThreadTranscript(
  input: LoadTakosMobileThreadTranscriptInput,
): Promise<TakosMobileThreadMessagesPage> {
  return await loadTakosMobileThreadMessages({
    session: input.session,
    threadId: input.threadId,
    limit: input.limit ?? defaultTranscriptMessageLimit,
    latest: true,
    fetch: input.fetch,
  });
}

export async function createTakosMobileChatMessage(
  input: CreateTakosMobileChatMessageInput,
): Promise<CreateTakosMobileChatMessageResult> {
  const content = input.content.trim();
  if (!content) {
    throw new Error("Message text is required.");
  }
  if (content.length > 20000) {
    throw new Error("Message text is too long.");
  }

  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const spaceId =
    input.spaceId?.trim() || (await resolveDefaultSpaceId(client.json));
  const locale = input.locale ?? detectLocale();
  const model = input.model ?? (await resolveSpaceModel(client.json, spaceId));
  const threadId =
    input.threadId?.trim() ||
    (await createMobileChatThread(client.json, {
      content,
      locale,
      spaceId,
    }));

  const messageResponse = await client.json<CreateMessageResponse>(
    `/api/threads/${encodePathSegment(threadId)}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ role: "user", content }),
    },
  );

  const runResponse = await client.json<CreateRunResponse>(
    `/api/threads/${encodePathSegment(threadId)}/runs`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        agent_type: "default",
        model,
        input: { locale },
      }),
    },
  );

  return {
    spaceId,
    threadId,
    routePath: `/chat/${encodePathSegment(spaceId)}/${encodePathSegment(
      threadId,
    )}`,
    messageId: mobileOptionalText(messageResponse.message?.id),
    runId: mobileOptionalText(runResponse.run?.id),
  };
}

export async function loadTakosMobileRunStatus(
  input: LoadTakosMobileRunStatusInput,
): Promise<TakosMobileRunSummary> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("Run id is required.");
  }
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<RunDetailResponse>(
    `/api/runs/${encodePathSegment(runId)}`,
  );
  const run = summarizeRun(response.run);
  if (!run) {
    throw new Error("Host did not return a run.");
  }
  return run;
}

export async function cancelTakosMobileRun(
  input: CancelTakosMobileRunInput,
): Promise<void> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("Run id is required.");
  }
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<{ readonly success?: boolean }>(
    `/api/runs/${encodePathSegment(runId)}/cancel`,
    {
      method: "POST",
    },
  );
  if (response.success === false) {
    throw new Error("Host did not cancel the run.");
  }
}

export async function loadTakosMobileRunEvents(
  input: LoadTakosMobileRunEventsInput,
): Promise<TakosMobileRunEventsPage> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("Run id is required.");
  }
  const lastEventId = normalizeEventCursor(input.lastEventId);
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<RunEventsResponse>(
    `/api/runs/${encodePathSegment(runId)}/events?last_event_id=${lastEventId}`,
  );
  const events = Array.isArray(response.events)
    ? response.events
        .map((event) => summarizeRunEvent(event))
        .filter((event): event is TakosMobileRunEvent => Boolean(event))
    : [];
  const runStatus =
    readRunStatus(response.run_status) ?? deriveStatusFromEvents(events);
  if (!runStatus) {
    throw new Error("Host did not return run status.");
  }
  return {
    events,
    runStatus,
    lastEventId: events.reduce(
      (cursor, event) => Math.max(cursor, event.id),
      lastEventId,
    ),
  };
}

export async function watchTakosMobileRunEventStream(
  input: WatchTakosMobileRunEventStreamInput,
): Promise<TakosMobileRunEventStreamResult> {
  const runId = input.runId.trim();
  if (!runId) {
    throw new Error("Run id is required.");
  }
  const lastEventId = normalizeEventCursor(input.lastEventId);
  if (input.signal?.aborted) {
    return { events: [], lastEventId, aborted: true };
  }
  const fetcher = input.fetch ?? globalThis.fetch.bind(globalThis);
  const response = await fetcher(
    hostEndpoint(
      input.session.hostUrl,
      `/api/runs/${encodePathSegment(runId)}/sse?last_event_id=${lastEventId}`,
    ),
    {
      headers: {
        accept: "text/event-stream",
        authorization: `${input.session.tokenType} ${input.session.accessToken}`,
      },
      signal: input.signal,
    },
  );
  if (!response.ok) {
    throw new Error(`Mobile run stream failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Host did not return a run stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let cursor = lastEventId;
  let terminalStatus: TakosMobileRunStatus | undefined;
  const events: TakosMobileRunEvent[] = [];

  try {
    while (!input.signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = splitSseFrames(buffer);
      buffer = frames.remainder;
      for (const frame of frames.frames) {
        const event = summarizeSseFrame(frame, runId);
        if (!event) continue;
        cursor = Math.max(cursor, event.id);
        events.push(event);
        await input.onEvent?.(event);
        if (event.status && isTakosMobileRunTerminalStatus(event.status)) {
          terminalStatus = event.status;
          return {
            events,
            lastEventId: cursor,
            terminalStatus,
            aborted: Boolean(input.signal?.aborted),
          };
        }
      }
    }
    buffer += decoder.decode();
    for (const frame of splitSseFrames(`${buffer}\n\n`).frames) {
      const event = summarizeSseFrame(frame, runId);
      if (!event) continue;
      cursor = Math.max(cursor, event.id);
      events.push(event);
      await input.onEvent?.(event);
      if (event.status && isTakosMobileRunTerminalStatus(event.status)) {
        terminalStatus = event.status;
        break;
      }
    }
  } catch (error) {
    if (!input.signal?.aborted && !isMobileAbortError(error)) {
      throw error;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    events,
    lastEventId: cursor,
    terminalStatus,
    aborted: Boolean(input.signal?.aborted),
  };
}

export function isTakosMobileRunTerminalStatus(
  status: TakosMobileRunStatus | string | undefined,
): boolean {
  return terminalRunStatuses.has(status as TakosMobileRunStatus);
}

async function loadThreadMessagePage(
  json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  input: {
    readonly threadId: string;
    readonly limit: number;
    readonly offset: number;
  },
): Promise<TakosMobileThreadMessagesPage> {
  const response = await json<ThreadMessagesResponse>(
    `/api/threads/${encodePathSegment(input.threadId)}/messages?limit=${
      input.limit
    }&offset=${input.offset}`,
  );
  const messages = Array.isArray(response.messages)
    ? response.messages
        .map((message) => summarizeThreadMessage(message))
        .filter((message): message is TakosMobileThreadMessagePreview =>
          Boolean(message),
        )
    : [];
  const total =
    typeof response.total === "number" && Number.isFinite(response.total)
      ? Math.max(0, Math.trunc(response.total))
      : messages.length;
  return {
    messages,
    total,
    limit:
      typeof response.limit === "number" && Number.isFinite(response.limit)
        ? normalizeMessageLimit(response.limit)
        : input.limit,
    offset:
      typeof response.offset === "number" && Number.isFinite(response.offset)
        ? normalizeMessageOffset(response.offset)
        : input.offset,
    hasOlder: input.offset > 0,
    nextOlderOffset:
      input.offset > 0 ? Math.max(0, input.offset - input.limit) : undefined,
  };
}

async function createMobileChatThread(
  json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  input: {
    readonly content: string;
    readonly locale: "ja" | "en";
    readonly spaceId: string;
  },
): Promise<string> {
  const title = truncateText(input.content.replace(/\s+/g, " "), 60);
  const threadResponse = await json<CreateThreadResponse>(
    `/api/spaces/${encodePathSegment(input.spaceId)}/threads`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ title, locale: input.locale }),
    },
  );
  const threadId = mobileOptionalText(threadResponse.thread?.id);
  if (!threadId) {
    throw new Error("Host did not return a chat thread.");
  }
  return threadId;
}

async function resolveDefaultSpaceId(
  json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
): Promise<string> {
  const response = await json<SpacesResponse>("/api/spaces");
  const space = Array.isArray(response.spaces)
    ? response.spaces.map(spaceIdentifier).find((candidate) => candidate)
    : undefined;
  if (!space) {
    throw new Error("No Takos workspace is available.");
  }
  return space;
}

async function resolveSpaceModel(
  json: <T = unknown>(path: string, init?: RequestInit) => Promise<T>,
  spaceId: string,
): Promise<string> {
  try {
    const response = await json<SpaceModelResponse>(
      `/api/spaces/${encodePathSegment(spaceId)}/model`,
    );
    return (
      mobileOptionalText(response.ai_model) ??
      mobileOptionalText(response.model) ??
      DEFAULT_TAKOS_MOBILE_MODEL
    );
  } catch {
    return DEFAULT_TAKOS_MOBILE_MODEL;
  }
}

function spaceIdentifier(space: unknown): string | undefined {
  if (!space || typeof space !== "object") return undefined;
  const record = space as Record<string, unknown>;
  if (record.kind === "user" || record.is_personal === true) return "me";
  return mobileOptionalText(record.slug) ?? mobileOptionalText(record.id);
}

function summarizeThreadMessage(
  message: unknown,
): TakosMobileThreadMessagePreview | undefined {
  if (!message || typeof message !== "object") return undefined;
  const record = message as Record<string, unknown>;
  const role =
    record.role === "user" || record.role === "assistant"
      ? record.role
      : undefined;
  const content = mobileOptionalText(record.content);
  if (!role || !content) return undefined;
  return {
    id: mobileOptionalText(record.id),
    sequence:
      typeof record.sequence === "number" && Number.isFinite(record.sequence)
        ? Math.trunc(record.sequence)
        : undefined,
    role,
    text: content.replace(/\s+/g, " ").slice(0, 140),
    createdAt: mobileOptionalText(record.created_at),
  };
}

function summarizeRun(run: unknown): TakosMobileRunSummary | undefined {
  if (!run || typeof run !== "object") return undefined;
  const record = run as Record<string, unknown>;
  const id = mobileOptionalText(record.id);
  const status = readRunStatus(record.status);
  if (!id || !status) return undefined;
  return {
    id,
    threadId: mobileOptionalText(record.thread_id),
    status,
    output: mobileOptionalText(record.output)?.slice(0, 180),
    error: mobileOptionalText(record.error)?.slice(0, 180),
    startedAt: mobileOptionalText(record.started_at),
    completedAt: mobileOptionalText(record.completed_at),
    createdAt: mobileOptionalText(record.created_at),
  };
}

function summarizeRunEvent(event: unknown): TakosMobileRunEvent | undefined {
  if (!event || typeof event !== "object") return undefined;
  const record = event as Record<string, unknown>;
  const id = mobileNumber(record.id, {
    acceptString: true,
    integer: true,
    min: 0,
  });
  const type = mobileOptionalText(record.type);
  const runId = mobileOptionalText(record.run_id);
  if (id === undefined || !type || !runId) return undefined;
  const data = mobileOptionalText(record.data);
  const message = deriveRunEventMessage(type, data);
  return {
    id,
    eventId: mobileOptionalText(record.event_id) ?? String(id),
    runId,
    type,
    data,
    status: deriveRunEventStatus(type, data),
    messageRole: message?.role,
    messageText: message?.text,
    assistantText: message?.role === "assistant" ? message.text : undefined,
    createdAt: mobileOptionalText(record.created_at),
  };
}

function summarizeSseFrame(
  frame: SseFrame,
  runId: string,
): TakosMobileRunEvent | undefined {
  if (frame.id === undefined || !frame.event || frame.data.length === 0) {
    return undefined;
  }
  return summarizeRunEvent({
    id: frame.id,
    event_id: String(frame.id),
    run_id: runId,
    type: frame.event,
    data: frame.data.join("\n"),
  });
}

function splitSseFrames(input: string): {
  readonly frames: readonly SseFrame[];
  readonly remainder: string;
} {
  const chunks = input.split(/\r?\n\r?\n/);
  const remainder = chunks.pop() ?? "";
  return {
    frames: chunks
      .map(parseSseFrame)
      .filter((frame): frame is SseFrame => Boolean(frame)),
    remainder,
  };
}

function parseSseFrame(frame: string): SseFrame | undefined {
  let id: number | undefined;
  let event = "";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    const separatorIndex = line.indexOf(":");
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const rawValue =
      separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "id") {
      id = mobileNumber(value, {
        acceptString: true,
        integer: true,
        min: 0,
      });
    } else if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  return id !== undefined || event || data.length > 0
    ? { id, event: event || "message", data }
    : undefined;
}

function deriveStatusFromEvents(
  events: readonly TakosMobileRunEvent[],
): TakosMobileRunStatus | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const status = events[index].status;
    if (status) return status;
  }
  return undefined;
}

function deriveRunEventStatus(
  type: string,
  data: string | undefined,
): TakosMobileRunStatus | undefined {
  if (type === "completed") return "completed";
  if (type === "cancelled") return "cancelled";
  if (type === "error" || type === "run.failed") return "failed";
  const payload = parseRunEventData(data);
  const run = mobileRecord(payload?.run);
  return readRunStatus(payload?.status) ?? readRunStatus(run?.status);
}

function deriveRunEventMessage(
  type: string,
  data: string | undefined,
):
  | { readonly role: TakosMobileRunEventMessageRole; readonly text: string }
  | undefined {
  const payload = parseRunEventData(data);
  if (!payload) return undefined;
  const message = mobileRecord(payload.message);
  const run = mobileRecord(payload.run);
  const role =
    readRunEventMessageRole(payload.role) ??
    readRunEventMessageRole(message?.role) ??
    defaultRunEventMessageRole(type);
  const candidate =
    mobileOptionalText(payload.content) ??
    mobileOptionalText(payload.text) ??
    mobileOptionalText(payload.delta) ??
    mobileOptionalText(payload.message) ??
    mobileOptionalText(message?.content) ??
    mobileOptionalText(run?.output);
  if (!candidate || !role) return undefined;
  if (
    type !== "message" &&
    type !== "run.message" &&
    type !== "assistant.message" &&
    type !== "completed"
  ) {
    return undefined;
  }
  return { role, text: candidate.replace(/\s+/g, " ").slice(0, 220) };
}

function parseRunEventData(
  data: string | undefined,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function detectLocale(): "ja" | "en" {
  const language = globalThis.navigator?.language?.toLowerCase() ?? "";
  return language.startsWith("ja") ? "ja" : "en";
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function truncateText(value: string, maxLength: number): string {
  const characters = Array.from(value);
  return characters.length > maxLength
    ? characters.slice(0, maxLength).join("")
    : value;
}

function readRunStatus(value: unknown): TakosMobileRunStatus | undefined {
  return value === "pending" ||
    value === "queued" ||
    value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : undefined;
}

function readRunEventMessageRole(
  value: unknown,
): TakosMobileRunEventMessageRole | undefined {
  return value === "assistant" ||
    value === "user" ||
    value === "system" ||
    value === "tool"
    ? value
    : undefined;
}

function defaultRunEventMessageRole(
  type: string,
): TakosMobileRunEventMessageRole | undefined {
  return type === "message" ||
    type === "run.message" ||
    type === "assistant.message" ||
    type === "completed"
    ? "assistant"
    : undefined;
}

function normalizeMessageLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultThreadMessageLimit;
  }
  return Math.max(1, Math.min(maxThreadMessageLimit, Math.trunc(value)));
}

function normalizeMessageOffset(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function normalizeEventCursor(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

interface SseFrame {
  readonly id?: number;
  readonly event: string;
  readonly data: readonly string[];
}

interface SpacesResponse {
  readonly spaces?: readonly unknown[];
}

interface ThreadMessagesResponse {
  readonly messages?: readonly unknown[];
  readonly total?: number;
  readonly limit?: number;
  readonly offset?: number;
}

interface SpaceModelResponse {
  readonly ai_model?: string;
  readonly model?: string;
}

interface CreateThreadResponse {
  readonly thread?: {
    readonly id?: string;
  };
}

interface CreateMessageResponse {
  readonly message?: {
    readonly id?: string;
  };
}

interface CreateRunResponse {
  readonly run?: {
    readonly id?: string;
  };
}

interface RunDetailResponse {
  readonly run?: unknown;
}

interface RunEventsResponse {
  readonly events?: readonly unknown[];
  readonly run_status?: unknown;
}
