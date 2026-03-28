import { describe, expect, it } from 'vitest';
import { asRunRow, runRowToApi, type RunRow } from '@/services/runs/run-serialization';

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

describe('asRunRow', () => {
  it('casts a generic record to RunRow', () => {
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
    expect(result.id).toBe('run-1');
    expect(result.threadId).toBe('thread-1');
  });
});

describe('runRowToApi', () => {
  it('converts a RunRow to a Run API object', () => {
    const row = makeRunRow();
    const run = runRowToApi(row);

    expect(run.id).toBe('run-1');
    expect(run.thread_id).toBe('thread-1');
    expect(run.space_id).toBe('space-1');
    expect(run.session_id).toBeNull();
    expect(run.parent_run_id).toBeNull();
    expect(run.child_thread_id).toBeNull();
    expect(run.root_thread_id).toBe('thread-1');
    expect(run.root_run_id).toBe('run-1');
    expect(run.agent_type).toBe('default');
    expect(run.status).toBe('running');
    expect(run.input).toBe('{}');
    expect(run.output).toBeNull();
    expect(run.error).toBeNull();
    expect(run.usage).toBe('{}');
    expect(run.worker_id).toBeNull();
    expect(run.worker_heartbeat).toBeNull();
    expect(run.started_at).toBeNull();
    expect(run.completed_at).toBeNull();
    expect(run.created_at).toBe('2026-03-01T00:00:00.000Z');
  });

  it('defaults rootThreadId to threadId when null', () => {
    const row = makeRunRow({ rootThreadId: null });
    const run = runRowToApi(row);
    expect(run.root_thread_id).toBe('thread-1');
  });

  it('defaults rootRunId to id when null', () => {
    const row = makeRunRow({ rootRunId: null });
    const run = runRowToApi(row);
    expect(run.root_run_id).toBe('run-1');
  });

  it('handles Date objects for timestamp fields', () => {
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

    expect(run.started_at).toBe('2026-03-01T01:00:00.000Z');
    expect(run.completed_at).toBe('2026-03-01T02:00:00.000Z');
    expect(run.created_at).toBe('2026-03-01T00:00:00.000Z');
    expect(run.worker_heartbeat).toBe('2026-03-01T01:30:00.000Z');
  });

  it('passes through string timestamps as-is', () => {
    const row = makeRunRow({
      startedAt: '2026-03-01T01:00:00.000Z',
      completedAt: '2026-03-01T02:00:00.000Z',
      workerHeartbeat: '2026-03-01T01:30:00.000Z',
    });

    const run = runRowToApi(row);

    expect(run.started_at).toBe('2026-03-01T01:00:00.000Z');
    expect(run.completed_at).toBe('2026-03-01T02:00:00.000Z');
    expect(run.worker_heartbeat).toBe('2026-03-01T01:30:00.000Z');
  });

  it('preserves all optional fields when populated', () => {
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

    expect(run.session_id).toBe('session-1');
    expect(run.parent_run_id).toBe('parent-run-1');
    expect(run.child_thread_id).toBe('child-thread-1');
    expect(run.root_thread_id).toBe('root-thread-1');
    expect(run.root_run_id).toBe('root-run-1');
    expect(run.output).toBe('{"result": "done"}');
    expect(run.error).toBe('something failed');
    expect(run.worker_id).toBe('worker-abc');
  });

  it('maps all valid status values', () => {
    const statuses = ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'] as const;
    for (const status of statuses) {
      const row = makeRunRow({ status });
      const run = runRowToApi(row);
      expect(run.status).toBe(status);
    }
  });
});
