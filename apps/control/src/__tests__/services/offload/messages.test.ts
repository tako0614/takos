import { describe, expect, it, vi } from 'vitest';
import { MockR2Bucket } from '../../../../test/integration/setup';

import {
  messageR2Key,
  shouldOffloadMessage,
  makeMessagePreview,
  writeMessageToR2,
  readMessageFromR2,
  MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS,
  MESSAGE_PREVIEW_MAX_CHARS,
  type PersistedMessage,
} from '@/services/offload/messages';

// ---------------------------------------------------------------------------
// messageR2Key
// ---------------------------------------------------------------------------

describe('messageR2Key', () => {
  it('builds the expected key', () => {
    expect(messageR2Key('thread-1', 'msg-1')).toBe(
      'threads/thread-1/messages/msg-1.json',
    );
  });

  it('handles ids containing special characters', () => {
    const key = messageR2Key('t/123', 'm-456');
    expect(key).toBe('threads/t/123/messages/m-456.json');
  });
});

// ---------------------------------------------------------------------------
// shouldOffloadMessage
// ---------------------------------------------------------------------------

describe('shouldOffloadMessage', () => {
  it('always offloads tool messages regardless of content length', () => {
    expect(shouldOffloadMessage({ role: 'tool', content: '' })).toBe(true);
    expect(shouldOffloadMessage({ role: 'tool', content: 'short' })).toBe(true);
  });

  it('offloads non-tool messages whose content exceeds threshold', () => {
    const longContent = 'x'.repeat(MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS + 1);
    expect(shouldOffloadMessage({ role: 'assistant', content: longContent })).toBe(true);
  });

  it('does not offload non-tool messages within threshold', () => {
    const shortContent = 'x'.repeat(MESSAGE_OFFLOAD_CONTENT_THRESHOLD_CHARS);
    expect(shouldOffloadMessage({ role: 'assistant', content: shortContent })).toBe(false);
  });

  it('does not offload user messages that are short', () => {
    expect(shouldOffloadMessage({ role: 'user', content: 'hello' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeMessagePreview
// ---------------------------------------------------------------------------

describe('makeMessagePreview', () => {
  it('returns content as-is when within limit', () => {
    const content = 'a'.repeat(MESSAGE_PREVIEW_MAX_CHARS);
    expect(makeMessagePreview(content)).toBe(content);
  });

  it('truncates and appends ellipsis when content exceeds limit', () => {
    const content = 'b'.repeat(MESSAGE_PREVIEW_MAX_CHARS + 100);
    const preview = makeMessagePreview(content);
    expect(preview).toHaveLength(MESSAGE_PREVIEW_MAX_CHARS + 3);
    expect(preview.endsWith('...')).toBe(true);
  });

  it('handles empty string', () => {
    expect(makeMessagePreview('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// writeMessageToR2 / readMessageFromR2
// ---------------------------------------------------------------------------

describe('writeMessageToR2', () => {
  it('writes a JSON-serialised message and returns the key', async () => {
    const bucket = new MockR2Bucket();
    const payload: PersistedMessage = {
      id: 'msg-1',
      thread_id: 'thread-1',
      role: 'assistant',
      content: 'hello world',
      tool_calls: null,
      tool_call_id: null,
      metadata: '{}',
      sequence: 1,
      created_at: '2025-01-01T00:00:00Z',
    };

    const result = await writeMessageToR2(bucket as never, 'thread-1', 'msg-1', payload);
    expect(result.key).toBe('threads/thread-1/messages/msg-1.json');

    // Verify the data was stored
    const stored = await bucket.get(result.key);
    expect(stored).not.toBeNull();
    const text = await stored!.text();
    const parsed = JSON.parse(text);
    expect(parsed.id).toBe('msg-1');
    expect(parsed.content).toBe('hello world');
  });
});

describe('readMessageFromR2', () => {
  it('reads and parses a stored message', async () => {
    const bucket = new MockR2Bucket();
    const payload: PersistedMessage = {
      id: 'msg-2',
      thread_id: 'thread-2',
      role: 'user',
      content: 'test content',
      tool_calls: null,
      tool_call_id: null,
      metadata: '{}',
      sequence: 2,
      created_at: '2025-01-01T00:00:00Z',
    };

    const key = messageR2Key('thread-2', 'msg-2');
    await bucket.put(key, JSON.stringify(payload));

    const result = await readMessageFromR2(bucket as never, key);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('msg-2');
    expect(result!.thread_id).toBe('thread-2');
    expect(result!.role).toBe('user');
    expect(result!.content).toBe('test content');
  });

  it('returns null for missing key', async () => {
    const bucket = new MockR2Bucket();
    const result = await readMessageFromR2(bucket as never, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    const bucket = new MockR2Bucket();
    await bucket.put('bad-key', 'not json');
    const result = await readMessageFromR2(bucket as never, 'bad-key');
    expect(result).toBeNull();
  });

  it('returns null when parsed object is missing required fields', async () => {
    const bucket = new MockR2Bucket();
    await bucket.put('partial-key', JSON.stringify({ id: 123 })); // id is not string
    const result = await readMessageFromR2(bucket as never, 'partial-key');
    expect(result).toBeNull();
  });

  it('returns null when id field is missing', async () => {
    const bucket = new MockR2Bucket();
    await bucket.put('no-id', JSON.stringify({ thread_id: 't', role: 'user', content: 'c' }));
    const result = await readMessageFromR2(bucket as never, 'no-id');
    expect(result).toBeNull();
  });

  it('returns null when content field is missing', async () => {
    const bucket = new MockR2Bucket();
    await bucket.put('no-content', JSON.stringify({ id: 'x', thread_id: 't', role: 'user' }));
    const result = await readMessageFromR2(bucket as never, 'no-content');
    expect(result).toBeNull();
  });
});
