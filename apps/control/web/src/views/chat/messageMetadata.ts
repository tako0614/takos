import type { ToolExecution } from '../../types';

export interface ChatAttachmentMetadata {
  file_id?: string;
  path?: string;
  name: string;
  mime_type?: string | null;
  size?: number;
}

export interface ParsedChatMessageMetadata {
  attachments: ChatAttachmentMetadata[];
  toolExecutions: ToolExecution[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAttachments(raw: unknown): ChatAttachmentMetadata[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (!isRecord(entry) || typeof entry.name !== 'string') return null;
      return {
        file_id: typeof entry.file_id === 'string' ? entry.file_id : undefined,
        path: typeof entry.path === 'string' ? entry.path : undefined,
        name: entry.name,
        mime_type: typeof entry.mime_type === 'string' ? entry.mime_type : null,
        size: typeof entry.size === 'number' ? entry.size : undefined,
      } satisfies ChatAttachmentMetadata;
    })
    .filter((entry): entry is ChatAttachmentMetadata => entry !== null);
}

function parseToolExecutions(raw: unknown): ToolExecution[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is ToolExecution => isRecord(entry) && typeof entry.name === 'string');
}

export function parseChatMessageMetadata(metadata: string | null | undefined): ParsedChatMessageMetadata {
  if (!metadata) {
    return { attachments: [], toolExecutions: [] };
  }

  try {
    const parsed = JSON.parse(metadata) as unknown;
    if (!isRecord(parsed)) {
      return { attachments: [], toolExecutions: [] };
    }

    return {
      attachments: parseAttachments(parsed.attachments),
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
    payload.attachments = input.attachments;
  }
  return JSON.stringify(payload);
}
