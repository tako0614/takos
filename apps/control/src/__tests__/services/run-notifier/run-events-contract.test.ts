import { describe, expect, it } from 'vitest';
import {
  buildRunFailedPayload,
  buildTerminalPayload,
  deriveTerminalStatusFromRunEvent,
  parseRunEventPayload,
} from '@/services/run-notifier/run-events-contract';

describe('run-events-contract', () => {
  it('derives terminal status from known terminal event types', () => {
    expect(deriveTerminalStatusFromRunEvent('completed', '{}')).toBe('completed');
    expect(deriveTerminalStatusFromRunEvent('error', '{}')).toBe('failed');
    expect(deriveTerminalStatusFromRunEvent('cancelled', '{}')).toBe('cancelled');
    expect(deriveTerminalStatusFromRunEvent('run.failed', '{}')).toBe('failed');
  });

  it('derives terminal status from run_status payload', () => {
    expect(deriveTerminalStatusFromRunEvent('run_status', '{"status":"completed"}')).toBe('completed');
    expect(deriveTerminalStatusFromRunEvent('run_status', { run: { status: 'failed' } })).toBe('failed');
    expect(deriveTerminalStatusFromRunEvent('run_status', { run: { status: 'cancelled' } })).toBe('cancelled');
  });

  it('returns null for non-terminal or malformed payloads', () => {
    expect(deriveTerminalStatusFromRunEvent('thinking', '{}')).toBeNull();
    expect(deriveTerminalStatusFromRunEvent('run_status', '{"status":"running"}')).toBeNull();
    expect(deriveTerminalStatusFromRunEvent('run_status', '{not-json')).toBeNull();
    expect(deriveTerminalStatusFromRunEvent('run_status', [])).toBeNull();
  });

  it('parses object and string payloads consistently', () => {
    expect(parseRunEventPayload('{"ok":true}')).toEqual({ ok: true });
    expect(parseRunEventPayload({ ok: true })).toEqual({ ok: true });
    expect(parseRunEventPayload('null')).toBeNull();
  });

  it('builds terminal payloads with run context', () => {
    expect(buildTerminalPayload('run-1', 'completed', { success: true }, 'sess-1')).toEqual({
      status: 'completed',
      run: {
        id: 'run-1',
        session_id: 'sess-1',
      },
      success: true,
    });

    expect(buildRunFailedPayload('run-2', 'boom', { permanent: true, sessionId: 'sess-2' })).toEqual({
      status: 'failed',
      run: {
        id: 'run-2',
        session_id: 'sess-2',
      },
      error: 'boom',
      permanent: true,
    });
  });
});
