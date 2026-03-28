import { describe, expect, it } from 'vitest';
import {
  addToRingBuffer,
  getEventsAfter,
  parseEventId,
  RING_BUFFER_SIZE,
  type RingBufferEvent,
} from '@/durable-objects/do-header-utils';

describe('parseEventId', () => {
  it('parses positive numbers', () => {
    expect(parseEventId(42)).toBe(42);
    expect(parseEventId(1)).toBe(1);
  });

  it('floors fractional numbers', () => {
    expect(parseEventId(3.7)).toBe(3);
  });

  it('parses numeric strings', () => {
    expect(parseEventId('10')).toBe(10);
    expect(parseEventId('001')).toBe(1);
  });

  it('returns null for non-positive values', () => {
    expect(parseEventId(0)).toBeNull();
    expect(parseEventId(-1)).toBeNull();
    expect(parseEventId('0')).toBeNull();
    expect(parseEventId('-5')).toBeNull();
  });

  it('returns null for non-numeric values', () => {
    expect(parseEventId(null)).toBeNull();
    expect(parseEventId(undefined)).toBeNull();
    expect(parseEventId('abc')).toBeNull();
    expect(parseEventId(NaN)).toBeNull();
    expect(parseEventId(Infinity)).toBeNull();
    expect(parseEventId({})).toBeNull();
  });
});

describe('addToRingBuffer', () => {
  it('assigns sequential IDs starting from 1', () => {
    const buffer: RingBufferEvent[] = [];
    const counter = { value: 0 };

    const id1 = addToRingBuffer(buffer, counter, 'a', { msg: 'first' });
    const id2 = addToRingBuffer(buffer, counter, 'b', { msg: 'second' });

    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(counter.value).toBe(2);
    expect(buffer).toHaveLength(2);
  });

  it('accepts preferred ID that advances counter', () => {
    const buffer: RingBufferEvent[] = [];
    const counter = { value: 5 };

    const id = addToRingBuffer(buffer, counter, 'x', null, 10);

    expect(id).toBe(10);
    expect(counter.value).toBe(10);
  });

  it('ignores preferred ID that does not advance counter (monotonicity)', () => {
    const buffer: RingBufferEvent[] = [];
    const counter = { value: 10 };

    // Preferred ID 5 is stale — should be ignored
    const id = addToRingBuffer(buffer, counter, 'x', null, 5);

    expect(id).toBe(11); // auto-assigned counter+1
    expect(counter.value).toBe(11);
  });

  it('ignores preferred ID equal to counter', () => {
    const buffer: RingBufferEvent[] = [];
    const counter = { value: 7 };

    const id = addToRingBuffer(buffer, counter, 'x', null, 7);

    expect(id).toBe(8);
    expect(counter.value).toBe(8);
  });

  it('ignores null/undefined preferred ID', () => {
    const buffer: RingBufferEvent[] = [];
    const counter = { value: 3 };

    expect(addToRingBuffer(buffer, counter, 'a', null, null)).toBe(4);
    expect(addToRingBuffer(buffer, counter, 'b', null, undefined)).toBe(5);
  });

  it('evicts oldest event when buffer exceeds capacity', () => {
    const buffer: RingBufferEvent[] = [];
    const counter = { value: 0 };

    for (let i = 0; i < RING_BUFFER_SIZE + 5; i++) {
      addToRingBuffer(buffer, counter, 'evt', i);
    }

    expect(buffer).toHaveLength(RING_BUFFER_SIZE);
    // First event should be evicted; buffer starts at id 6
    expect(buffer[0].id).toBe(6);
    expect(buffer[buffer.length - 1].id).toBe(RING_BUFFER_SIZE + 5);
  });

  it('produces monotonically increasing IDs across mixed calls', () => {
    const buffer: RingBufferEvent[] = [];
    const counter = { value: 0 };

    const ids: number[] = [];
    ids.push(addToRingBuffer(buffer, counter, 'a', null));          // 1
    ids.push(addToRingBuffer(buffer, counter, 'b', null, 10));      // 10
    ids.push(addToRingBuffer(buffer, counter, 'c', null));          // 11
    ids.push(addToRingBuffer(buffer, counter, 'd', null, 5));       // 12 (stale, ignored)
    ids.push(addToRingBuffer(buffer, counter, 'e', null, 20));      // 20
    ids.push(addToRingBuffer(buffer, counter, 'f', null));          // 21

    expect(ids).toEqual([1, 10, 11, 12, 20, 21]);

    // Verify all IDs in buffer are monotonically increasing
    for (let i = 1; i < buffer.length; i++) {
      expect(buffer[i].id).toBeGreaterThan(buffer[i - 1].id);
    }
  });
});

describe('getEventsAfter', () => {
  const makeBuffer = (...ids: number[]): RingBufferEvent[] =>
    ids.map((id) => ({ id, type: 'test', data: null, timestamp: Date.now() }));

  it('returns events with id greater than lastEventId', () => {
    const buffer = makeBuffer(1, 2, 3, 4, 5);

    const result = getEventsAfter(buffer, 3);

    expect(result.map((e) => e.id)).toEqual([4, 5]);
  });

  it('returns all events when lastEventId is 0', () => {
    const buffer = makeBuffer(1, 2, 3);

    expect(getEventsAfter(buffer, 0)).toHaveLength(3);
  });

  it('returns empty array when lastEventId >= max id', () => {
    const buffer = makeBuffer(1, 2, 3);

    expect(getEventsAfter(buffer, 3)).toHaveLength(0);
    expect(getEventsAfter(buffer, 100)).toHaveLength(0);
  });

  it('returns empty array for empty buffer', () => {
    expect(getEventsAfter([], 0)).toHaveLength(0);
  });

  it('handles non-contiguous IDs', () => {
    const buffer = makeBuffer(5, 10, 15, 20);

    const result = getEventsAfter(buffer, 10);

    expect(result.map((e) => e.id)).toEqual([15, 20]);
  });
});
