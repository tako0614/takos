import { describe, expect, it } from 'vitest';
import { buildRunNotifierEmitPayload } from '@/services/run-notifier/run-notifier-payload';

describe('run-notifier-payload helper', () => {
  it('adds event_id when present', () => {
    const payload = buildRunNotifierEmitPayload(
      'run-1',
      'run.failed',
      { status: 'failed' },
      55,
    );
    expect(payload).toEqual({
      runId: 'run-1',
      type: 'run.failed',
      data: { status: 'failed' },
      event_id: 55,
    });
  });

  it('omits event_id when event id is missing', () => {
    const payload = buildRunNotifierEmitPayload(
      'run-2',
      'progress',
      { phase: 'exec' },
      null,
    );
    expect(payload).toEqual({
      runId: 'run-2',
      type: 'progress',
      data: { phase: 'exec' },
    });
  });
});
