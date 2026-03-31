import { asRunRow, runRowToApi, type RunRow } from '@/services/runs/run-serialization';

import { assertEquals } from 'jsr:@std/assert';

function makeRunRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run-1',
    threadId: 'thread-1',
    spaceId: 'space-1',
    sessionId: null,
    parentRunId: null,
    childThreadId: null,
    rootThreadId: 'thread-1',
    rootRunId: 'run-1',
    agentType: 'default',
    status: 'running',
    input: '{}',
    output: null,
    error: null,
    usage: '{}',
    workerId: null,
    workerHeartbeat: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}


  Deno.test('asRunRow - casts a generic record to RunRow', () => {
  const raw: Record<string, unknown> = {
      id: 'run-1',
      threadId: 'thread-1',
      spaceId: 'space-1',
      sessionId: null,
      parentRunId: null,
      childThreadId: null,
      rootThreadId: null,
      rootRunId: null,
      agentType: 'default',
      status: 'running',
      input: '{}',
      output: null,
      error: null,
      usage: '{}',
      workerId: null,
      workerHeartbeat: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
    };

    const result = asRunRow(raw);
    assertEquals(result.id, 'run-1');
    assertEquals(result.threadId, 'thread-1');
})

  Deno.test('runRowToApi - converts a RunRow to a Run API object', () => {
  const row = makeRunRow();
    const run = runRowToApi(row);

    assertEquals(run.id, 'run-1');
    assertEquals(run.thread_id, 'thread-1');
    assertEquals(run.space_id, 'space-1');
    assertEquals(run.session_id, null);
    assertEquals(run.parent_run_id, null);
    assertEquals(run.child_thread_id, null);
    assertEquals(run.root_thread_id, 'thread-1');
    assertEquals(run.root_run_id, 'run-1');
    assertEquals(run.agent_type, 'default');
    assertEquals(run.status, 'running');
    assertEquals(run.input, '{}');
    assertEquals(run.output, null);
    assertEquals(run.error, null);
    assertEquals(run.usage, '{}');
    assertEquals(run.worker_id, null);
    assertEquals(run.worker_heartbeat, null);
    assertEquals(run.started_at, null);
    assertEquals(run.completed_at, null);
    assertEquals(run.created_at, '2026-03-01T00:00:00.000Z');
})
  Deno.test('runRowToApi - defaults rootThreadId to threadId when null', () => {
  const row = makeRunRow({ rootThreadId: null });
    const run = runRowToApi(row);
    assertEquals(run.root_thread_id, 'thread-1');
})
  Deno.test('runRowToApi - defaults rootRunId to id when null', () => {
  const row = makeRunRow({ rootRunId: null });
    const run = runRowToApi(row);
    assertEquals(run.root_run_id, 'run-1');
})
  Deno.test('runRowToApi - handles Date objects for timestamp fields', () => {
  const startedAt = new Date('2026-03-01T01:00:00.000Z');
    const completedAt = new Date('2026-03-01T02:00:00.000Z');
    const createdAt = new Date('2026-03-01T00:00:00.000Z');
    const workerHeartbeat = new Date('2026-03-01T01:30:00.000Z');

    const row = makeRunRow({
      startedAt,
      completedAt,
      createdAt,
      workerHeartbeat,
    });

    const run = runRowToApi(row);

    assertEquals(run.started_at, '2026-03-01T01:00:00.000Z');
    assertEquals(run.completed_at, '2026-03-01T02:00:00.000Z');
    assertEquals(run.created_at, '2026-03-01T00:00:00.000Z');
    assertEquals(run.worker_heartbeat, '2026-03-01T01:30:00.000Z');
})
  Deno.test('runRowToApi - passes through string timestamps as-is', () => {
  const row = makeRunRow({
      startedAt: '2026-03-01T01:00:00.000Z',
      completedAt: '2026-03-01T02:00:00.000Z',
      workerHeartbeat: '2026-03-01T01:30:00.000Z',
    });

    const run = runRowToApi(row);

    assertEquals(run.started_at, '2026-03-01T01:00:00.000Z');
    assertEquals(run.completed_at, '2026-03-01T02:00:00.000Z');
    assertEquals(run.worker_heartbeat, '2026-03-01T01:30:00.000Z');
})
  Deno.test('runRowToApi - preserves all optional fields when populated', () => {
  const row = makeRunRow({
      sessionId: 'session-1',
      parentRunId: 'parent-run-1',
      childThreadId: 'child-thread-1',
      rootThreadId: 'root-thread-1',
      rootRunId: 'root-run-1',
      output: '{"result": "done"}',
      error: 'something failed',
      workerId: 'worker-abc',
    });

    const run = runRowToApi(row);

    assertEquals(run.session_id, 'session-1');
    assertEquals(run.parent_run_id, 'parent-run-1');
    assertEquals(run.child_thread_id, 'child-thread-1');
    assertEquals(run.root_thread_id, 'root-thread-1');
    assertEquals(run.root_run_id, 'root-run-1');
    assertEquals(run.output, '{"result": "done"}');
    assertEquals(run.error, 'something failed');
    assertEquals(run.worker_id, 'worker-abc');
})
  Deno.test('runRowToApi - maps all valid status values', () => {
  const statuses = ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'] as const;
    for (const status of statuses) {
      const row = makeRunRow({ status });
      const run = runRowToApi(row);
      assertEquals(run.status, status);
    }
})