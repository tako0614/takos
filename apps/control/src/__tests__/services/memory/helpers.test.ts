import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseJsonArrayFromLLM, chatAndParseJsonArray } from '@/services/memory/helpers';

describe('parseJsonArrayFromLLM', () => {
  it('parses a plain JSON array', () => {
    const result = parseJsonArrayFromLLM<{ name: string }>('[{"name":"alice"},{"name":"bob"}]');
    expect(result).toEqual([{ name: 'alice' }, { name: 'bob' }]);
  });

  it('extracts JSON array from markdown code fences', () => {
    const input = '```json\n[{"type":"semantic","content":"test"}]\n```';
    const result = parseJsonArrayFromLLM(input);
    expect(result).toEqual([{ type: 'semantic', content: 'test' }]);
  });

  it('extracts JSON array from surrounding text', () => {
    const input = 'Here are the results:\n[{"a":1}]\nDone!';
    const result = parseJsonArrayFromLLM(input);
    expect(result).toEqual([{ a: 1 }]);
  });

  it('returns null when no array found', () => {
    expect(parseJsonArrayFromLLM('no array here')).toBeNull();
    expect(parseJsonArrayFromLLM('{"not":"an_array"}')).toBeNull();
  });

  it('returns null for invalid JSON array', () => {
    expect(parseJsonArrayFromLLM('[invalid json]')).toBeNull();
  });

  it('handles empty array', () => {
    expect(parseJsonArrayFromLLM('[]')).toEqual([]);
  });

  it('handles nested arrays', () => {
    const result = parseJsonArrayFromLLM('[[1,2],[3,4]]');
    expect(result).toEqual([[1, 2], [3, 4]]);
  });

  it('handles multiline JSON arrays', () => {
    const input = `[\n  {"type": "episode", "content": "decided to use React"},\n  {"type": "semantic", "content": "user is in fintech"}\n]`;
    const result = parseJsonArrayFromLLM(input);
    expect(result).toHaveLength(2);
  });
});

describe('chatAndParseJsonArray', () => {
  it('calls LLM and parses response', async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({
        content: '[{"type":"semantic","content":"test"}]',
      }),
    };

    const result = await chatAndParseJsonArray(
      mockLLM as any,
      'system prompt',
      'user prompt'
    );

    expect(mockLLM.chat).toHaveBeenCalledWith(
      [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      []
    );
    expect(result).toEqual([{ type: 'semantic', content: 'test' }]);
  });

  it('returns null when LLM throws', async () => {
    const mockLLM = {
      chat: vi.fn().mockRejectedValue(new Error('API error')),
    };

    const result = await chatAndParseJsonArray(mockLLM as any, 'sys', 'usr');
    expect(result).toBeNull();
  });

  it('returns null when LLM returns unparseable response', async () => {
    const mockLLM = {
      chat: vi.fn().mockResolvedValue({ content: 'no json here' }),
    };

    const result = await chatAndParseJsonArray(mockLLM as any, 'sys', 'usr');
    expect(result).toBeNull();
  });
});
