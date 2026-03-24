import { describe, expect, it } from 'vitest';
import {
  RUN_TERMINAL_EVENT_TYPES,
  TERMINAL_STATUS_BY_EVENT_TYPE,
  buildRunFailedPayload,
  buildTerminalPayload,
} from '@/application/services/run-notifier/run-events-contract';

describe('run events contract', () => {
  it('builds terminal payload with status and run metadata', () => {
    const payload = buildTerminalPayload('run_1', 'completed', { success: true }, 'session_1');

    expect(payload).toEqual({
      status: 'completed',
      run: {
        id: 'run_1',
        session_id: 'session_1',
      },
      success: true,
    });
  });

  it('builds failed payload with optional permanence and session id', () => {
    const payload = buildRunFailedPayload('run_2', 'failed permanently', {
      permanent: true,
      sessionId: null,
    });

    expect(payload).toEqual({
      status: 'failed',
      run: {
        id: 'run_2',
        session_id: null,
      },
      error: 'failed permanently',
      permanent: true,
    });
  });

  it('maps terminal event types to terminal statuses', () => {
    expect(TERMINAL_STATUS_BY_EVENT_TYPE['completed']).toBe('completed');
    expect(TERMINAL_STATUS_BY_EVENT_TYPE['error']).toBe('failed');
    expect(TERMINAL_STATUS_BY_EVENT_TYPE['cancelled']).toBe('cancelled');
    expect(TERMINAL_STATUS_BY_EVENT_TYPE['run.failed']).toBe('failed');
    expect(RUN_TERMINAL_EVENT_TYPES.has('completed')).toBe(true);
    expect(RUN_TERMINAL_EVENT_TYPES.has('run.failed')).toBe(true);
    expect(RUN_TERMINAL_EVENT_TYPES.has('run.status' as never)).toBe(false);
  });
});
