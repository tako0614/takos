import { describe, expect, it } from 'vitest';

import {
  normalizeStringArray,
  isDelegationLocale,
  isProductHint,
  parseRunInputObject,
  getDelegationPacketFromRunInput,
  inferProductHintFromTextSamples,
  buildDelegationPacket,
  buildDelegationSystemMessage,
  buildDelegationUserMessage,
  PRODUCT_HINTS,
  type DelegationPacket,
} from '@/services/agent/delegation';

describe('normalizeStringArray', () => {
  it('filters and trims string arrays', () => {
    expect(normalizeStringArray(['  hello ', ' world ', '', '  '])).toEqual(['hello', 'world']);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeStringArray('not-an-array')).toEqual([]);
    expect(normalizeStringArray(null)).toEqual([]);
    expect(normalizeStringArray(undefined)).toEqual([]);
    expect(normalizeStringArray(42)).toEqual([]);
  });

  it('filters out non-string items', () => {
    expect(normalizeStringArray([1, null, 'valid', undefined, 'ok'])).toEqual(['valid', 'ok']);
  });
});

describe('isDelegationLocale', () => {
  it('accepts ja and en', () => {
    expect(isDelegationLocale('ja')).toBe(true);
    expect(isDelegationLocale('en')).toBe(true);
  });

  it('rejects other values', () => {
    expect(isDelegationLocale('fr')).toBe(false);
    expect(isDelegationLocale('')).toBe(false);
    expect(isDelegationLocale(null)).toBe(false);
    expect(isDelegationLocale(undefined)).toBe(false);
    expect(isDelegationLocale(42)).toBe(false);
  });
});

describe('isProductHint', () => {
  it('accepts all known product hints', () => {
    for (const hint of PRODUCT_HINTS) {
      expect(isProductHint(hint)).toBe(true);
    }
  });

  it('rejects unknown values', () => {
    expect(isProductHint('unknown-product')).toBe(false);
    expect(isProductHint('')).toBe(false);
    expect(isProductHint(null)).toBe(false);
    expect(isProductHint(42)).toBe(false);
  });
});

describe('parseRunInputObject', () => {
  it('parses JSON string into object', () => {
    expect(parseRunInputObject('{"task":"do it"}')).toEqual({ task: 'do it' });
  });

  it('returns empty object for invalid JSON string', () => {
    expect(parseRunInputObject('not-json')).toEqual({});
  });

  it('returns empty object for array JSON', () => {
    expect(parseRunInputObject('[1,2,3]')).toEqual({});
  });

  it('passes through object input', () => {
    expect(parseRunInputObject({ task: 'test' })).toEqual({ task: 'test' });
  });

  it('returns empty object for non-object types', () => {
    expect(parseRunInputObject(null)).toEqual({});
    expect(parseRunInputObject(undefined)).toEqual({});
    expect(parseRunInputObject(42)).toEqual({});
    expect(parseRunInputObject([])).toEqual({});
  });
});

describe('getDelegationPacketFromRunInput', () => {
  const validInput = {
    task: 'Fix the bug',
    parent_run_id: 'run-1',
    parent_thread_id: 'thread-1',
    root_thread_id: 'root-1',
    goal: 'Make it pass tests',
    deliverable: 'Working code',
    constraints: ['Do not break API'],
    context: ['Found bug in module X'],
    acceptance_criteria: ['All tests pass'],
    product_hint: 'takos',
    locale: 'ja',
    thread_summary: 'Bug investigation',
    thread_key_points: ['Module X is affected'],
  };

  it('extracts a valid delegation packet from object input', () => {
    const result = getDelegationPacketFromRunInput(validInput);
    expect(result).not.toBeNull();
    expect(result!.task).toBe('Fix the bug');
    expect(result!.goal).toBe('Make it pass tests');
    expect(result!.product_hint).toBe('takos');
    expect(result!.locale).toBe('ja');
    expect(result!.constraints).toEqual(['Do not break API']);
  });

  it('extracts from nested delegation object', () => {
    const result = getDelegationPacketFromRunInput({ delegation: validInput });
    expect(result).not.toBeNull();
    expect(result!.task).toBe('Fix the bug');
  });

  it('extracts from JSON string', () => {
    const result = getDelegationPacketFromRunInput(JSON.stringify(validInput));
    expect(result).not.toBeNull();
    expect(result!.task).toBe('Fix the bug');
  });

  it('returns null when required fields are missing', () => {
    expect(getDelegationPacketFromRunInput({ task: 'no parent run id' })).toBeNull();
    expect(getDelegationPacketFromRunInput({})).toBeNull();
    expect(getDelegationPacketFromRunInput(null)).toBeNull();
  });

  it('normalizes invalid product_hint and locale to null', () => {
    const result = getDelegationPacketFromRunInput({
      ...validInput,
      product_hint: 'unknown',
      locale: 'fr',
    });
    expect(result!.product_hint).toBeNull();
    expect(result!.locale).toBeNull();
  });
});

describe('inferProductHintFromTextSamples', () => {
  it('detects takos from text samples', () => {
    expect(inferProductHintFromTextSamples(['Fix apps/control module'])).toBe('takos');
    expect(inferProductHintFromTextSamples(['Update takos-control'])).toBe('takos');
  });

  it('detects yurucommu from text samples', () => {
    expect(inferProductHintFromTextSamples(['Update yurucommu feature'])).toBe('yurucommu');
  });

  it('detects roadtome from text samples', () => {
    expect(inferProductHintFromTextSamples(['road-to-me improvements'])).toBe('roadtome');
    expect(inferProductHintFromTextSamples(['road to me product'])).toBe('roadtome');
  });

  it('returns null when no product is detected', () => {
    expect(inferProductHintFromTextSamples(['generic task'])).toBeNull();
    expect(inferProductHintFromTextSamples([])).toBeNull();
  });

  it('returns null for ambiguous (tied) scores', () => {
    expect(inferProductHintFromTextSamples(['takos yurucommu'])).toBeNull();
  });

  it('skips null/undefined samples', () => {
    expect(inferProductHintFromTextSamples([null, undefined, 'takos stuff'])).toBe('takos');
  });
});

describe('buildDelegationPacket', () => {
  it('builds a packet with explicit fields', () => {
    const { packet, observability } = buildDelegationPacket({
      task: 'Implement feature',
      goal: 'Ship the feature',
      deliverable: 'Code + tests',
      constraints: ['No breaking changes'],
      context: ['Parent found the root cause'],
      acceptanceCriteria: ['Tests pass'],
      productHint: 'takos',
      locale: 'ja',
      parentRunId: 'run-1',
      parentThreadId: 'thread-1',
      rootThreadId: 'root-1',
      threadSummary: 'Working on feature X',
      threadKeyPoints: ['Key point 1'],
    });

    expect(packet.task).toBe('Implement feature');
    expect(packet.goal).toBe('Ship the feature');
    expect(packet.product_hint).toBe('takos');
    expect(packet.locale).toBe('ja');
    expect(observability.explicit_field_count).toBeGreaterThanOrEqual(7);
  });

  it('infers goal from latestUserMessage when not explicitly provided', () => {
    const { packet, observability } = buildDelegationPacket({
      task: 'Fix bug',
      latestUserMessage: 'Make it work properly',
      parentRunId: 'run-1',
      parentThreadId: 'thread-1',
      rootThreadId: 'root-1',
    });

    expect(packet.goal).toBe('Make it work properly');
    expect(observability.inferred_field_count).toBeGreaterThanOrEqual(1);
  });

  it('infers product hint from text samples', () => {
    const { packet } = buildDelegationPacket({
      task: 'Fix apps/control module in takos',
      parentRunId: 'run-1',
      parentThreadId: 'thread-1',
      rootThreadId: 'root-1',
    });

    expect(packet.product_hint).toBe('takos');
  });

  it('infers locale from parent run input', () => {
    const { packet } = buildDelegationPacket({
      task: 'Fix bug',
      parentRunId: 'run-1',
      parentThreadId: 'thread-1',
      rootThreadId: 'root-1',
      parentRunInput: { locale: 'ja' },
    });

    expect(packet.locale).toBe('ja');
  });

  it('falls back to threadLocale and workspaceLocale', () => {
    const { packet: p1 } = buildDelegationPacket({
      task: 'Fix',
      parentRunId: 'r1',
      parentThreadId: 't1',
      rootThreadId: 'rt1',
      threadLocale: 'en',
    });
    expect(p1.locale).toBe('en');

    const { packet: p2 } = buildDelegationPacket({
      task: 'Fix',
      parentRunId: 'r1',
      parentThreadId: 't1',
      rootThreadId: 'rt1',
      workspaceLocale: 'ja',
    });
    expect(p2.locale).toBe('ja');
  });

  it('throws when task is empty', () => {
    expect(() =>
      buildDelegationPacket({
        task: '  ',
        parentRunId: 'r1',
        parentThreadId: 't1',
        rootThreadId: 'rt1',
      }),
    ).toThrow('Delegation task must be a non-empty string');
  });

  it('tracks observability counters accurately', () => {
    const { observability } = buildDelegationPacket({
      task: 'Do work',
      parentRunId: 'run-1',
      parentThreadId: 'thread-1',
      rootThreadId: 'root-1',
      threadSummary: 'Summary exists',
    });

    expect(observability.has_thread_summary).toBe(true);
    expect(observability.constraints_count).toBe(0);
    expect(observability.context_count).toBe(0);
  });
});

describe('buildDelegationSystemMessage', () => {
  const packet: DelegationPacket = {
    task: 'Implement the fix',
    goal: 'Improve autonomy',
    deliverable: 'Code changes',
    constraints: ['Do not break API'],
    context: ['Parent isolated the bug'],
    acceptance_criteria: ['Tests pass'],
    product_hint: 'takos',
    locale: 'ja',
    parent_run_id: 'run-1',
    parent_thread_id: 'thread-1',
    root_thread_id: 'root-1',
    thread_summary: 'Agent delegation fix',
    thread_key_points: ['Sub-agent context'],
  };

  it('includes all non-empty fields in the system message', () => {
    const msg = buildDelegationSystemMessage(packet);
    expect(msg.role).toBe('system');
    expect(msg.content).toContain('Delegated execution context:');
    expect(msg.content).toContain('Goal: Improve autonomy');
    expect(msg.content).toContain('Product hint: takos');
    expect(msg.content).toContain('Deliverable: Code changes');
    expect(msg.content).toContain('Parent thread summary: Agent delegation fix');
    expect(msg.content).toContain('Constraints:');
    expect(msg.content).toContain('- Do not break API');
    expect(msg.content).toContain('Relevant context:');
    expect(msg.content).toContain('- Parent isolated the bug');
    expect(msg.content).toContain('Acceptance criteria:');
    expect(msg.content).toContain('- Tests pass');
  });

  it('omits empty optional fields', () => {
    const minimalPacket: DelegationPacket = {
      task: 'Do it',
      goal: null,
      deliverable: null,
      constraints: [],
      context: [],
      acceptance_criteria: [],
      product_hint: null,
      locale: null,
      parent_run_id: 'run-1',
      parent_thread_id: 'thread-1',
      root_thread_id: 'root-1',
      thread_summary: null,
      thread_key_points: [],
    };
    const msg = buildDelegationSystemMessage(minimalPacket);
    expect(msg.content).toBe('Delegated execution context:');
  });
});

describe('buildDelegationUserMessage', () => {
  it('creates a user message with parent run reference', () => {
    const packet: DelegationPacket = {
      task: 'Implement feature X',
      goal: null,
      deliverable: null,
      constraints: [],
      context: [],
      acceptance_criteria: [],
      product_hint: null,
      locale: null,
      parent_run_id: 'run-42',
      parent_thread_id: 'thread-1',
      root_thread_id: 'root-1',
      thread_summary: null,
      thread_key_points: [],
    };
    const msg = buildDelegationUserMessage(packet);
    expect(msg.role).toBe('user');
    expect(msg.content).toContain('run: run-42');
    expect(msg.content).toContain('Implement feature X');
  });
});
