export const CHAT_SEARCH_QUERY_MAX_LENGTH = 500;
export const CHAT_SEARCH_RESULT_LIMIT = 20;

export type ChatSearchType = "all" | "keyword" | "semantic";

export interface ChatSearchResult {
  kind: "keyword" | "semantic";
  score?: number;
  thread: {
    id: string;
    title: string | null;
    status: "active" | "archived";
  };
  message: { id: string; sequence: number };
  snippet: string;
  match: { start: number; end: number } | null;
}

export interface ChatSearchResponse {
  results: ChatSearchResult[];
  semanticAvailable: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(
  value: unknown,
  field: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" || value.length > maxLength ||
    (!allowEmpty && !value.trim())
  ) {
    throw new TypeError(`Search response has invalid ${field}`);
  }
  return value;
}

function parseResult(value: unknown): ChatSearchResult {
  const candidate = record(value);
  const thread = record(candidate?.thread);
  const message = record(candidate?.message);
  if (!candidate || !thread || !message) {
    throw new TypeError("Search response has an invalid result");
  }
  if (candidate.kind !== "keyword" && candidate.kind !== "semantic") {
    throw new TypeError("Search response has an invalid result kind");
  }
  if (thread.status !== "active" && thread.status !== "archived") {
    throw new TypeError("Search response has an invalid thread status");
  }
  if (
    !Number.isSafeInteger(message.sequence) ||
    (message.sequence as number) < 0
  ) {
    throw new TypeError("Search response has an invalid message sequence");
  }
  const score = candidate.score;
  if (
    (candidate.kind === "semantic" &&
      (typeof score !== "number" || !Number.isFinite(score))) ||
    (candidate.kind === "keyword" && score !== undefined)
  ) {
    throw new TypeError("Search response has an invalid score");
  }
  const snippet = boundedString(candidate.snippet, "snippet", 1_000, true);
  let match: ChatSearchResult["match"] = null;
  if (candidate.match !== null && candidate.match !== undefined) {
    const rawMatch = record(candidate.match);
    if (
      !rawMatch || !Number.isSafeInteger(rawMatch.start) ||
      !Number.isSafeInteger(rawMatch.end) ||
      (rawMatch.start as number) < 0 ||
      (rawMatch.end as number) <= (rawMatch.start as number) ||
      (rawMatch.end as number) > snippet.length
    ) {
      throw new TypeError("Search response has an invalid match range");
    }
    match = {
      start: rawMatch.start as number,
      end: rawMatch.end as number,
    };
  }
  const title = thread.title === null
    ? null
    : boundedString(thread.title, "thread title", 500, true);
  return {
    kind: candidate.kind,
    ...(typeof score === "number" ? { score } : {}),
    thread: {
      id: boundedString(thread.id, "thread id", 256),
      title,
      status: thread.status,
    },
    message: {
      id: boundedString(message.id, "message id", 256),
      sequence: message.sequence as number,
    },
    snippet,
    match,
  };
}

export function parseChatSearchResponse(
  value: unknown,
  expected: { query: string; type: ChatSearchType },
): ChatSearchResponse {
  const candidate = record(value);
  if (
    !candidate || candidate.query !== expected.query ||
    candidate.type !== expected.type ||
    candidate.limit !== CHAT_SEARCH_RESULT_LIMIT || candidate.offset !== 0 ||
    typeof candidate.semantic_available !== "boolean" ||
    !Array.isArray(candidate.results) ||
    candidate.results.length > CHAT_SEARCH_RESULT_LIMIT
  ) {
    throw new TypeError("Invalid search response");
  }
  const results = candidate.results.map(parseResult);
  const ids = new Set<string>();
  for (const result of results) {
    const id = `${result.thread.id}:${result.message.id}`;
    if (ids.has(id)) {
      throw new TypeError("Search response contains duplicate results");
    }
    ids.add(id);
  }
  return {
    results,
    semanticAvailable: candidate.semantic_available,
  };
}

