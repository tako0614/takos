import { describe, expect, it } from 'vitest';
import { deriveRunStatusFromTimelineEvents } from '@/routes/runs/observation';

describe('deriveRunStatusFromTimelineEvents', () => {
  it('keeps fallback status when timeline has no terminal events', () => {
    const status = deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'thinking',
        data: '{"message":"processing"}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ]);

    expect(status).toBe('running');
  });

  it('maps completion/error/cancelled packets to terminal run status', () => {
    expect(deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'completed',
        data: '{}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ])).toBe('completed');

    expect(deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'error',
        data: '{"error":"boom"}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ])).toBe('failed');

    expect(deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'run.failed',
        data: '{"error":"queue failed"}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ])).toBe('failed');

    expect(deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'cancelled',
        data: '{}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ])).toBe('cancelled');
  });

  it('maps run_status terminal payload to terminal run status', () => {
    expect(deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'run_status',
        data: '{"status":"completed"}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ])).toBe('completed');

    expect(deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'run_status',
        data: '{"run":{"status":"failed"}}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
    ])).toBe('failed');

    expect(deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'run_status',
        data: '{"status":"running"}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
      {
        event_id: 2,
        type: 'run_status',
        data: '{"run":{"status":"cancelled"}}',
        created_at: '2026-02-27T00:00:01.000Z',
      },
    ])).toBe('cancelled');
  });

  it('uses the latest observed terminal packet when multiple exist', () => {
    const status = deriveRunStatusFromTimelineEvents('running', [
      {
        event_id: 1,
        type: 'error',
        data: '{"error":"first"}',
        created_at: '2026-02-27T00:00:00.000Z',
      },
      {
        event_id: 2,
        type: 'cancelled',
        data: '{}',
        created_at: '2026-02-27T00:00:01.000Z',
      },
    ]);

    expect(status).toBe('cancelled');
  });
});
