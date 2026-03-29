import { describe, expect, it } from 'vitest';

type TimelineEventType = 'thinking' | 'tool' | 'result' | 'error' | 'completed' | 'cancelled' | 'run_status' | 'progress' | 'run.failed';
type TimelineEvent = { type: TimelineEventType; data: Record<string, unknown> };
// Agent RunStatus must stay aligned with the canonical shared models definition.
type RunStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseEventData(data: unknown): Record<string, unknown> {
  if (typeof data !== 'string') {
    return isRecord(data) ? data : {};
  }
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) ? parsed : { message: data };
  } catch {
    return { message: data };
  }
}

function normalizeTimelineEventType(type: string): TimelineEventType {
  if (type === 'run.failed') return type;
  if (['thinking', 'tool', 'result', 'error', 'completed', 'cancelled', 'run_status', 'progress'].includes(type)) {
    return type as TimelineEventType;
  }
  return 'error';
}

function parseTimelineEventId(event: Record<string, unknown>): number | undefined {
  const raw = event.id ?? event.event_id;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getTerminalRunStatusFromTimelineEvent(type: string, data: Record<string, unknown>): RunStatus | undefined {
  if (type === 'completed') return 'completed';
  if (type === 'cancelled') return 'cancelled';
  if (type === 'error' || type === 'run.failed') return 'failed';
  if (type !== 'run_status') return undefined;
  const direct = data.status;
  if (direct === 'completed' || direct === 'failed' || direct === 'cancelled') return direct;
  const run = isRecord(data.run) ? data.run : undefined;
  const nested = run?.status;
  if (nested === 'completed' || nested === 'failed' || nested === 'cancelled') return nested;
  return undefined;
}

function deriveRunStatusFromTimelineEvents(initialStatus: RunStatus, events: TimelineEvent[]): RunStatus {
  let status = initialStatus;
  for (const event of events) {
    const terminal = getTerminalRunStatusFromTimelineEvent(event.type, event.data);
    if (terminal) {
      status = terminal;
    }
  }
  return status;
}

function isRunInRootTree(runId: string, rootRunId: string, byId: Map<string, { id: string; parent_run_id: string | null }>): boolean {
  const seen = new Set<string>();
  let currentId: string | null = runId;
  while (currentId) {
    if (currentId === rootRunId) return true;
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    currentId = byId.get(currentId)?.parent_run_id ?? null;
  }
  return false;
}

describe('chat timeline helpers', () => {
  it('parses JSON payload strings', () => {
    const parsed = parseEventData('{"message":"hello","tool":"file_read"}');
    expect(parsed.message).toBe('hello');
    expect(parsed.tool).toBe('file_read');
  });

  it('falls back to message payload for non-JSON strings', () => {
    const parsed = parseEventData('plain text');
    expect(parsed).toEqual({ message: 'plain text' });
  });

  it('normalizes unknown event types to error', () => {
    expect(normalizeTimelineEventType('progress')).toBe('progress');
    expect(normalizeTimelineEventType('unexpected_event')).toBe('error');
  });

  it('parses event ids from numeric and string forms', () => {
    expect(parseTimelineEventId({ id: 42 })).toBe(42);
    expect(parseTimelineEventId({ event_id: '11' })).toBe(11);
    expect(parseTimelineEventId({ event_id: 'x' })).toBeUndefined();
  });

  it('maps terminal timeline event types to terminal run statuses', () => {
    expect(getTerminalRunStatusFromTimelineEvent('completed', {})).toBe('completed');
    expect(getTerminalRunStatusFromTimelineEvent('cancelled', {})).toBe('cancelled');
    expect(getTerminalRunStatusFromTimelineEvent('error', {})).toBe('failed');
    expect(getTerminalRunStatusFromTimelineEvent('run.failed', {})).toBe('failed');
    expect(getTerminalRunStatusFromTimelineEvent('run_status', { status: 'completed' })).toBe('completed');
    expect(getTerminalRunStatusFromTimelineEvent('run_status', { status: 'failed' })).toBe('failed');
    expect(getTerminalRunStatusFromTimelineEvent('run_status', { status: 'cancelled' })).toBe('cancelled');
    expect(getTerminalRunStatusFromTimelineEvent('run_status', { run: { status: 'completed' } })).toBe('completed');
  });

  it('derives terminal status from timeline events with fallback', () => {
    expect(deriveRunStatusFromTimelineEvents('running', [
      { type: 'thinking', data: { message: '...' } },
      { type: 'completed', data: { success: true } },
    ])).toBe('completed');

    expect(deriveRunStatusFromTimelineEvents('queued', [
      { type: 'progress', data: { message: 'step 1' } },
      { type: 'error', data: { error: 'boom' } },
      { type: 'cancelled', data: {} },
    ])).toBe('cancelled');

    expect(deriveRunStatusFromTimelineEvents('running', [
      { type: 'run_status', data: { status: 'failed' } },
    ])).toBe('failed');

    expect(deriveRunStatusFromTimelineEvents('running', [
      { type: 'thinking', data: { message: 'still running' } },
    ])).toBe('running');
  });

  it('resolves whether a run belongs to a root run tree', () => {
    const byId = new Map([
      ['root', { id: 'root', parent_run_id: null }],
      ['child', { id: 'child', parent_run_id: 'root' }],
      ['grandchild', { id: 'grandchild', parent_run_id: 'child' }],
      ['other', { id: 'other', parent_run_id: null }],
    ]);

    expect(isRunInRootTree('root', 'root', byId)).toBe(true);
    expect(isRunInRootTree('child', 'root', byId)).toBe(true);
    expect(isRunInRootTree('grandchild', 'root', byId)).toBe(true);
    expect(isRunInRootTree('other', 'root', byId)).toBe(false);
  });

  it('fails closed on cyclic parent chains', () => {
    const byId = new Map([
      ['root', { id: 'root', parent_run_id: null }],
      ['a', { id: 'a', parent_run_id: 'b' }],
      ['b', { id: 'b', parent_run_id: 'a' }],
    ]);

    expect(isRunInRootTree('a', 'root', byId)).toBe(false);
  });
});
