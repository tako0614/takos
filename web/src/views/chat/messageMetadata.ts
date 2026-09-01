import type { ToolExecution } from "../../types/index.ts";
import {
  type ChatAttachmentMetadata,
  MAX_CHAT_MESSAGE_METADATA_CHARACTERS,
  parseChatAttachmentMetadataList,
} from "takos-api-contract/chat-message";

export type { ChatAttachmentMetadata } from "takos-api-contract/chat-message";

export interface ParsedChatMessageMetadata {
  attachments: ChatAttachmentMetadata[];
  toolExecutions: ToolExecution[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_TOOL_EXECUTIONS = 100;
const MAX_TOOL_NAME_CHARACTERS = 255;
const MAX_TOOL_DETAIL_CHARACTERS = 64 * 1024;
const MAX_TOOL_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const INLINE_IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function isChatAttachmentInlineImageMimeType(
  mimeType: string | null | undefined,
): boolean {
  return typeof mimeType === "string" &&
    INLINE_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

function boundedString(
  value: unknown,
  maximum: number,
): string | undefined {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

function parseToolExecutions(raw: unknown): ToolExecution[] {
  if (!Array.isArray(raw)) return [];
  const executions: ToolExecution[] = [];
  for (const entry of raw.slice(0, MAX_TOOL_EXECUTIONS)) {
    if (!isRecord(entry)) continue;
    const name = boundedString(entry.name, MAX_TOOL_NAME_CHARACTERS);
    if (!name) continue;
    const result = entry.result === undefined
      ? undefined
      : boundedString(entry.result, MAX_TOOL_DETAIL_CHARACTERS);
    if (entry.result !== undefined && !result) continue;
    const error = entry.error === undefined
      ? undefined
      : boundedString(entry.error, MAX_TOOL_DETAIL_CHARACTERS);
    if (entry.error !== undefined && !error) continue;
    const duration = entry.duration_ms;
    if (
      duration !== undefined &&
      (typeof duration !== "number" || !Number.isSafeInteger(duration) ||
        duration < 0 || duration > MAX_TOOL_DURATION_MS)
    ) {
      continue;
    }
    executions.push({
      name,
      arguments: isRecord(entry.arguments) ? entry.arguments : {},
      result,
      error,
      duration_ms: duration,
    });
  }
  return executions;
}

export function parseChatMessageMetadata(
  metadata: string | null | undefined,
  expectedThreadId?: string,
): ParsedChatMessageMetadata {
  if (!metadata || metadata.length > MAX_CHAT_MESSAGE_METADATA_CHARACTERS) {
    return { attachments: [], toolExecutions: [] };
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!isRecord(parsed)) {
      return { attachments: [], toolExecutions: [] };
    }

    return {
      attachments: parseChatAttachmentMetadataList(
        parsed.attachments,
        expectedThreadId,
      ),
      toolExecutions: parseToolExecutions(parsed.tool_executions),
    };
  } catch {
    return { attachments: [], toolExecutions: [] };
  }
}

export function buildChatMessageMetadata(input: {
  attachments?: ChatAttachmentMetadata[];
}): string {
  const payload: Record<string, unknown> = {};
  if (input.attachments && input.attachments.length > 0) {
    payload.attachments = parseChatAttachmentMetadataList(input.attachments);
  }
  return JSON.stringify(payload);
}
