import type { R2Bucket } from '../../../shared/types/bindings.ts';
import type { MessageRole } from '../../../shared/types';

export type PersistedMessage = {
  id: string;
  thread_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  tool_call_id: string | null;
  metadata: string;
  sequence: number;
  created_at: string;
};

export const MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS = 4000;
export const MESSAGE_PREVIEW_MAX_CHARS = 800;

export function messageR2Key(threadId: string, messageId: string): string {
  return `threads/${threadId}/messages/${messageId}.json`;
}

export function shouldOffloadMessage(input: {
  role: MessageRole;
  content: string;
}): boolean {
  if (input.role === 'tool') return true;
  return input.content.length > MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS;
}

export function makeMessagePreview(content: string): string {
  if (content.length <= MESSAGE_PREVIEW_MAX_CHARS) return content;
  return content.slice(0, MESSAGE_PREVIEW_MAX_CHARS) + '...';
}

export async function writeMessageToR2(
  bucket: R2Bucket,
  threadId: string,
  messageId: string,
  payload: PersistedMessage
): Promise<{ key: string }> {
  const key = messageR2Key(threadId, messageId);
  await bucket.put(key, JSON.stringify(payload), {
    httpMetadata: { contentType: 'application/json' },
  });
  return { key };
}

export async function readMessageFromR2(
  bucket: R2Bucket,
  key: string
): Promise<PersistedMessage | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  try {
    const parsed = JSON.parse(await obj.text()) as PersistedMessage;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.id !== 'string') return null;
    if (typeof parsed.thread_id !== 'string') return null;
    if (typeof parsed.role !== 'string') return null;
    if (typeof parsed.content !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

