export const MAX_CLIENT_MESSAGE_CHARACTERS = 20_000;
export const MAX_CLIENT_MESSAGE_ATTACHMENTS = 10;
export const MAX_CLIENT_ATTACHMENT_ID_CHARACTERS = 128;
export const MAX_CLIENT_ATTACHMENT_NAME_CHARACTERS = 255;
export const MAX_CLIENT_ATTACHMENT_PATH_CHARACTERS = 1_024;
export const MAX_CLIENT_ATTACHMENT_MIME_CHARACTERS = 255;
export const MAX_CLIENT_ATTACHMENT_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_CHAT_MESSAGE_METADATA_CHARACTERS = 256 * 1024;
export const DEFAULT_CHAT_TIMELINE_MESSAGES = 100;
export const MAX_CHAT_TIMELINE_MESSAGES = 200;

export interface ChatAttachmentMetadata {
  file_id?: string;
  path?: string;
  name: string;
  mime_type?: string | null;
  size?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string | undefined {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return undefined;
  }
  return value;
}

export function isExactThreadAttachmentPath(
  path: string,
  threadId: string,
  name: string,
): boolean {
  const safeThreadId = boundedString(
    threadId,
    MAX_CLIENT_ATTACHMENT_ID_CHARACTERS,
  );
  if (
    !safeThreadId || safeThreadId !== safeThreadId.trim() ||
    safeThreadId.includes("/") || safeThreadId.includes("\\")
  ) {
    return false;
  }
  return path === `/chat-attachments/${safeThreadId}/${name}`;
}

/**
 * Parse persisted attachment display metadata without turning it into file
 * authority. When a Thread is supplied, downloadable entries must name the
 * exact direct child path that the Worker reserves for that Thread.
 */
export function parseChatAttachmentMetadataList(
  raw: unknown,
  expectedThreadId?: string,
): ChatAttachmentMetadata[] {
  if (!Array.isArray(raw)) return [];

  const parsed: ChatAttachmentMetadata[] = [];
  for (const entry of raw.slice(0, MAX_CLIENT_MESSAGE_ATTACHMENTS)) {
    if (!isRecord(entry)) continue;
    const name = boundedString(
      entry.name,
      MAX_CLIENT_ATTACHMENT_NAME_CHARACTERS,
    );
    if (
      !name || name !== name.trim() || name === "." || name === ".." ||
      name.includes("/") || name.includes("\\")
    ) {
      continue;
    }

    const fileId = entry.file_id === undefined
      ? undefined
      : boundedString(entry.file_id, MAX_CLIENT_ATTACHMENT_ID_CHARACTERS);
    if (
      entry.file_id !== undefined &&
      (!fileId || fileId !== fileId.trim() || fileId.includes("/") ||
        fileId.includes("\\"))
    ) {
      continue;
    }

    const path = entry.path === undefined
      ? undefined
      : boundedString(entry.path, MAX_CLIENT_ATTACHMENT_PATH_CHARACTERS);
    if (entry.path !== undefined && !path) continue;
    if (
      fileId && expectedThreadId &&
      (!path || !isExactThreadAttachmentPath(path, expectedThreadId, name))
    ) {
      continue;
    }

    let mimeType: string | null | undefined;
    if (entry.mime_type === null) {
      mimeType = null;
    } else if (entry.mime_type !== undefined) {
      mimeType = boundedString(
        entry.mime_type,
        MAX_CLIENT_ATTACHMENT_MIME_CHARACTERS,
      );
      if (!mimeType) continue;
    }

    let size: number | undefined;
    if (entry.size !== undefined) {
      if (
        typeof entry.size !== "number" || !Number.isSafeInteger(entry.size) ||
        entry.size < 0 || entry.size > MAX_CLIENT_ATTACHMENT_SIZE_BYTES
      ) {
        continue;
      }
      size = entry.size;
    }

    parsed.push({
      file_id: fileId,
      path,
      name,
      mime_type: mimeType,
      size,
    });
  }
  return parsed;
}
