import {
  createMobileApiClient,
  mobileNumber,
  mobileOptionalText,
  type FetchLike,
  type MobileSession,
} from "@takosjp/takosumi-mobile-kit";
import type { TakosMobileMemoryPreview } from "./home.ts";

export interface CreateTakosMobileMemoryInput {
  readonly session: MobileSession;
  readonly spaceId: string;
  readonly content: string;
  readonly type?: TakosMobileMemoryPreview["type"];
  readonly category?: string;
  readonly importance?: number;
  readonly fetch?: FetchLike;
}

export interface DeleteTakosMobileMemoryInput {
  readonly session: MobileSession;
  readonly memoryId: string;
  readonly fetch?: FetchLike;
}

export async function createTakosMobileMemory(
  input: CreateTakosMobileMemoryInput,
): Promise<TakosMobileMemoryPreview> {
  const spaceId = input.spaceId.trim();
  if (!spaceId) {
    throw new Error("Workspace is required.");
  }
  const content = input.content.trim();
  if (!content) {
    throw new Error("Memory text is required.");
  }
  if (content.length > 100000) {
    throw new Error("Memory text is too long.");
  }
  const type = input.type ?? "semantic";
  const category = input.category?.trim() || undefined;
  const importance = normalizeImportance(input.importance);

  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<MemoryCreateResponse>(
    `/api/spaces/${encodeURIComponent(spaceId)}/memories`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        type,
        content,
        category,
        source: "takos-mobile",
        importance,
      }),
    },
  );
  const memory = summarizeCreatedMemory(response);
  if (!memory) {
    throw new Error("Host did not return a memory.");
  }
  return memory;
}

export async function deleteTakosMobileMemory(
  input: DeleteTakosMobileMemoryInput,
): Promise<void> {
  const memoryId = input.memoryId.trim();
  if (!memoryId) {
    throw new Error("Memory id is required.");
  }
  const client = createMobileApiClient({
    session: input.session,
    fetch: input.fetch,
  });
  const response = await client.json<{ readonly success?: boolean }>(
    `/api/memories/${encodeURIComponent(memoryId)}`,
    {
      method: "DELETE",
    },
  );
  if (response.success === false) {
    throw new Error("Host did not delete the memory.");
  }
}

type MemoryCreateResponse =
  | Record<string, unknown>
  | {
      readonly memory?: Record<string, unknown>;
    };

function summarizeCreatedMemory(
  response: MemoryCreateResponse,
): TakosMobileMemoryPreview | undefined {
  const record = unwrapMemoryResponse(response);
  const id = mobileOptionalText(record.id);
  const type = readMemoryType(record.type);
  const text =
    mobileOptionalText(record.summary) ?? mobileOptionalText(record.content);
  if (!id || !type || !text) return undefined;
  return {
    id,
    type,
    text: text.slice(0, 180),
    category: mobileOptionalText(record.category),
    importance: mobileNumber(record.importance),
    createdAt: mobileOptionalText(record.created_at),
    routePath: "/memory",
  };
}

function unwrapMemoryResponse(
  response: MemoryCreateResponse,
): Record<string, unknown> {
  const wrapped =
    "memory" in response &&
    response.memory &&
    typeof response.memory === "object"
      ? response.memory
      : response;
  return wrapped as Record<string, unknown>;
}

function normalizeImportance(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function readMemoryType(
  value: unknown,
): TakosMobileMemoryPreview["type"] | undefined {
  return value === "episode" || value === "semantic" || value === "procedural"
    ? value
    : undefined;
}
