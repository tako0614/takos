import {
  addToRingBuffer,
  getEventsAfter,
  parseEventId,
  RING_BUFFER_SIZE,
  type RingBufferEvent,
} from '@/durable-objects/do-header-utils';


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('parseEventId - parses positive numbers', () => {
  assertEquals(parseEventId(42), 42);
    assertEquals(parseEventId(1), 1);
})
  Deno.test('parseEventId - floors fractional numbers', () => {
  assertEquals(parseEventId(3.7), 3);
})
  Deno.test('parseEventId - parses numeric strings', () => {
  assertEquals(parseEventId('10'), 10);
    assertEquals(parseEventId('001'), 1);
})
  Deno.test('parseEventId - returns null for non-positive values', () => {
  assertEquals(parseEventId(0), null);
    assertEquals(parseEventId(-1), null);
    assertEquals(parseEventId('0'), null);
    assertEquals(parseEventId('-5'), null);
})
  Deno.test('parseEventId - returns null for non-numeric values', () => {
  assertEquals(parseEventId(null), null);
    assertEquals(parseEventId(undefined), null);
    assertEquals(parseEventId('abc'), null);
    assertEquals(parseEventId(NaN), null);
    assertEquals(parseEventId(Infinity), null);
    assertEquals(parseEventId({}), null);
})

  Deno.test('addToRingBuffer - assigns sequential IDs starting from 1', () => {
  const buffer: RingBufferEvent[] = [];
    const counter = { value: 0 };

    const id1 = addToRingBuffer(buffer, counter, 'a', { msg: 'first' });
    const id2 = addToRingBuffer(buffer, counter, 'b', { msg: 'second' });

    assertEquals(id1, 1);
    assertEquals(id2, 2);
    assertEquals(counter.value, 2);
    assertEquals(buffer.length, 2);
})
  Deno.test('addToRingBuffer - accepts preferred ID that advances counter', () => {
  const buffer: RingBufferEvent[] = [];
    const counter = { value: 5 };

    const id = addToRingBuffer(buffer, counter, 'x', null, 10);

    assertEquals(id, 10);
    assertEquals(counter.value, 10);
})
  Deno.test('addToRingBuffer - ignores preferred ID that does not advance counter (monotonicity)', () => {
  const buffer: RingBufferEvent[] = [];
    const counter = { value: 10 };

    // Preferred ID 5 is stale — should be ignored
    const id = addToRingBuffer(buffer, counter, 'x', null, 5);

    assertEquals(id, 11); // auto-assigned counter+1
    assertEquals(counter.value, 11);
})
  Deno.test('addToRingBuffer - ignores preferred ID equal to counter', () => {
  const buffer: RingBufferEvent[] = [];
    const counter = { value: 7 };

    const id = addToRingBuffer(buffer, counter, 'x', null, 7);

    assertEquals(id, 8);
    assertEquals(counter.value, 8);
})
  Deno.test('addToRingBuffer - ignores null/undefined preferred ID', () => {
  const buffer: RingBufferEvent[] = [];
    const counter = { value: 3 };

    assertEquals(addToRingBuffer(buffer, counter, 'a', null, null), 4);
    assertEquals(addToRingBuffer(buffer, counter, 'b', null, undefined), 5);
})
  Deno.test('addToRingBuffer - evicts oldest event when buffer exceeds capacity', () => {
  const buffer: RingBufferEvent[] = [];
    const counter = { value: 0 };

    for (let i = 0; i < RING_BUFFER_SIZE + 5; i++) {
      addToRingBuffer(buffer, counter, 'evt', i);
    }

    assertEquals(buffer.length, RING_BUFFER_SIZE);
    // First event should be evicted; buffer starts at id 6
    assertEquals(buffer[0].id, 6);
    assertEquals(buffer[buffer.length - 1].id, RING_BUFFER_SIZE + 5);
})
  Deno.test('addToRingBuffer - produces monotonically increasing IDs across mixed calls', () => {
  const buffer: RingBufferEvent[] = [];
    const counter = { value: 0 };

    const ids: number[] = [];
    ids.push(addToRingBuffer(buffer, counter, 'a', null));          // 1
    ids.push(addToRingBuffer(buffer, counter, 'b', null, 10));      // 10
    ids.push(addToRingBuffer(buffer, counter, 'c', null));          // 11
    ids.push(addToRingBuffer(buffer, counter, 'd', null, 5));       // 12 (stale, ignored)
    ids.push(addToRingBuffer(buffer, counter, 'e', null, 20));      // 20
    ids.push(addToRingBuffer(buffer, counter, 'f', null));          // 21

    assertEquals(ids, [1, 10, 11, 12, 20, 21]);

    // Verify all IDs in buffer are monotonically increasing
    for (let i = 1; i < buffer.length; i++) {
      assert(buffer[i].id > buffer[i - 1].id);
    }
})

  const makeBuffer = (...ids: number[]): RingBufferEvent[] =>
    ids.map((id) => ({ id, type: 'test', data: null, timestamp: Date.now() }));

  Deno.test('getEventsAfter - returns events with id greater than lastEventId', () => {
  const buffer = makeBuffer(1, 2, 3, 4, 5);

    const result = getEventsAfter(buffer, 3);

    assertEquals(result.map((e) => e.id), [4, 5]);
})
  Deno.test('getEventsAfter - returns all events when lastEventId is 0', () => {
  const buffer = makeBuffer(1, 2, 3);

    assertEquals(getEventsAfter(buffer, 0).length, 3);
})
  Deno.test('getEventsAfter - returns empty array when lastEventId >= max id', () => {
  const buffer = makeBuffer(1, 2, 3);

    assertEquals(getEventsAfter(buffer, 3).length, 0);
    assertEquals(getEventsAfter(buffer, 100).length, 0);
})
  Deno.test('getEventsAfter - returns empty array for empty buffer', () => {
  assertEquals(getEventsAfter([], 0).length, 0);
})
  Deno.test('getEventsAfter - handles non-contiguous IDs', () => {
  const buffer = makeBuffer(5, 10, 15, 20);

    const result = getEventsAfter(buffer, 10);

    assertEquals(result.map((e) => e.id), [15, 20]);
})