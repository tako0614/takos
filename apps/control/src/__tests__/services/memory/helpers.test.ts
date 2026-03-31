import { parseJsonArrayFromLLM, chatAndParseJsonArray } from '@/services/memory/helpers';


import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

  Deno.test('parseJsonArrayFromLLM - parses a plain JSON array', () => {
  const result = parseJsonArrayFromLLM<{ name: string }>('[{"name":"alice"},{"name":"bob"}]');
    assertEquals(result, [{ name: 'alice' }, { name: 'bob' }]);
})
  Deno.test('parseJsonArrayFromLLM - extracts JSON array from markdown code fences', () => {
  const input = '```json\n[{"type":"semantic","content":"test"}]\n```';
    const result = parseJsonArrayFromLLM(input);
    assertEquals(result, [{ type: 'semantic', content: 'test' }]);
})
  Deno.test('parseJsonArrayFromLLM - extracts JSON array from surrounding text', () => {
  const input = 'Here are the results:\n[{"a":1}]\nDone!';
    const result = parseJsonArrayFromLLM(input);
    assertEquals(result, [{ a: 1 }]);
})
  Deno.test('parseJsonArrayFromLLM - returns null when no array found', () => {
  assertEquals(parseJsonArrayFromLLM('no array here'), null);
    assertEquals(parseJsonArrayFromLLM('{"not":"an_array"}'), null);
})
  Deno.test('parseJsonArrayFromLLM - returns null for invalid JSON array', () => {
  assertEquals(parseJsonArrayFromLLM('[invalid json]'), null);
})
  Deno.test('parseJsonArrayFromLLM - handles empty array', () => {
  assertEquals(parseJsonArrayFromLLM('[]'), []);
})
  Deno.test('parseJsonArrayFromLLM - handles nested arrays', () => {
  const result = parseJsonArrayFromLLM('[[1,2],[3,4]]');
    assertEquals(result, [[1, 2], [3, 4]]);
})
  Deno.test('parseJsonArrayFromLLM - handles multiline JSON arrays', () => {
  const input = `[\n  {"type": "episode", "content": "decided to use React"},\n  {"type": "semantic", "content": "user is in fintech"}\n]`;
    const result = parseJsonArrayFromLLM(input);
    assertEquals(result.length, 2);
})

  Deno.test('chatAndParseJsonArray - calls LLM and parses response', async () => {
  const mockLLM = {
      chat: (async () => ({
        content: '[{"type":"semantic","content":"test"}]',
      })),
    };

    const result = await chatAndParseJsonArray(
      mockLLM as any,
      'system prompt',
      'user prompt'
    );

    assertSpyCallArgs(mockLLM.chat, 0, [
      [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: 'user prompt' },
      ],
      []
    ]);
    assertEquals(result, [{ type: 'semantic', content: 'test' }]);
})
  Deno.test('chatAndParseJsonArray - returns null when LLM throws', async () => {
  const mockLLM = {
      chat: (async () => { throw new Error('API error'); }),
    };

    const result = await chatAndParseJsonArray(mockLLM as any, 'sys', 'usr');
    assertEquals(result, null);
})
  Deno.test('chatAndParseJsonArray - returns null when LLM returns unparseable response', async () => {
  const mockLLM = {
      chat: (async () => ({ content: 'no json here' })),
    };

    const result = await chatAndParseJsonArray(mockLLM as any, 'sys', 'usr');
    assertEquals(result, null);
})