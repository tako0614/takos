import { describe, expect, it } from 'vitest';
import {
  parseStartPayload,
  createConcurrencyGuard,
} from '../executor-utils.js';

// ---------------------------------------------------------------------------
// parseStartPayload
// ---------------------------------------------------------------------------

describe('parseStartPayload', () => {
  const validPayload = {
    runId: 'run-123',
    workerId: 'worker-abc',
    controlRpcToken: 'tok_secret',
  };

  it('accepts a valid payload with required fields', () => {
    const result = parseStartPayload(validPayload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.runId).toBe('run-123');
      expect(result.payload.serviceId).toBe('worker-abc');
      expect(result.payload.workerId).toBe('worker-abc');
      expect(result.payload.controlRpcToken).toBe('tok_secret');
    }
  });

  it('accepts serviceId without workerId and normalizes workerId for compatibility', () => {
    const result = parseStartPayload({
      runId: 'run-123',
      serviceId: 'service-abc',
      controlRpcToken: 'tok_secret',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.serviceId).toBe('service-abc');
      expect(result.payload.workerId).toBe('service-abc');
    }
  });

  it('accepts optional string fields', () => {
    const result = parseStartPayload({
      ...validPayload,
      model: 'gpt-4',
      controlRpcBaseUrl: 'https://control.example.com',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.model).toBe('gpt-4');
      expect(result.payload.controlRpcBaseUrl).toBe('https://control.example.com');
    }
  });

  it('returns model as undefined when not provided', () => {
    const result = parseStartPayload(validPayload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.model).toBeUndefined();
      expect(result.payload.controlRpcBaseUrl).toBeUndefined();
    }
  });

  it('rejects null body', () => {
    const result = parseStartPayload(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Request body must be a JSON object');
    }
  });

  it('rejects array body', () => {
    const result = parseStartPayload([1, 2, 3]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Request body must be a JSON object');
    }
  });

  it('rejects non-object body', () => {
    const result = parseStartPayload('string');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Request body must be a JSON object');
    }
  });

  it('rejects number body', () => {
    const result = parseStartPayload(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Request body must be a JSON object');
    }
  });

  it('rejects missing runId', () => {
    const result = parseStartPayload({ workerId: 'w', controlRpcToken: 'tok' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Missing required field: runId');
    }
  });

  it('rejects empty runId', () => {
    const result = parseStartPayload({ runId: '', workerId: 'w', controlRpcToken: 'tok' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Missing required field: runId');
    }
  });

  it('rejects non-string runId', () => {
    const result = parseStartPayload({ runId: 123, workerId: 'w', controlRpcToken: 'tok' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Missing required field: runId');
    }
  });

  it('rejects missing workerId', () => {
    const result = parseStartPayload({ runId: 'r', controlRpcToken: 'tok' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Missing required field: serviceId or workerId');
    }
  });

  it('rejects empty workerId', () => {
    const result = parseStartPayload({ runId: 'r', workerId: '', controlRpcToken: 'tok' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Missing required field: serviceId or workerId');
    }
  });

  it('rejects missing controlRpcToken', () => {
    const result = parseStartPayload({ runId: 'r', workerId: 'w' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Missing required field: controlRpcToken');
    }
  });

  it('rejects empty controlRpcToken', () => {
    const result = parseStartPayload({ runId: 'r', workerId: 'w', controlRpcToken: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Missing required field: controlRpcToken');
    }
  });

  it('rejects non-string model', () => {
    const result = parseStartPayload({ ...validPayload, model: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('model must be a string when provided');
    }
  });

  it('rejects non-string controlRpcBaseUrl', () => {
    const result = parseStartPayload({ ...validPayload, controlRpcBaseUrl: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('controlRpcBaseUrl must be a string when provided');
    }
  });

  it('ignores extra unknown fields', () => {
    const result = parseStartPayload({ ...validPayload, extra: 'field', another: 42 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.runId).toBe('run-123');
    }
  });
});

// ---------------------------------------------------------------------------
// createConcurrencyGuard
// ---------------------------------------------------------------------------

describe('createConcurrencyGuard', () => {
  it('creates a guard with correct max', () => {
    const guard = createConcurrencyGuard(3);
    expect(guard.maxConcurrentRuns).toBe(3);
    expect(guard.activeRuns).toBe(0);
    expect(guard.available).toBe(3);
  });

  it('tryAcquire increments active runs', () => {
    const guard = createConcurrencyGuard(2);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.activeRuns).toBe(1);
    expect(guard.available).toBe(1);
  });

  it('tryAcquire returns false when at capacity', () => {
    const guard = createConcurrencyGuard(2);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.tryAcquire()).toBe(false);
    expect(guard.activeRuns).toBe(2);
    expect(guard.available).toBe(0);
  });

  it('release decrements active runs', () => {
    const guard = createConcurrencyGuard(2);
    guard.tryAcquire();
    guard.tryAcquire();
    guard.release();
    expect(guard.activeRuns).toBe(1);
    expect(guard.available).toBe(1);
  });

  it('release clamps at 0 (does not go negative)', () => {
    const guard = createConcurrencyGuard(1);
    guard.release();
    expect(guard.activeRuns).toBe(0);
    expect(guard.available).toBe(1);
  });

  it('allows acquire after release frees capacity', () => {
    const guard = createConcurrencyGuard(1);
    guard.tryAcquire();
    expect(guard.tryAcquire()).toBe(false);
    guard.release();
    expect(guard.tryAcquire()).toBe(true);
    expect(guard.activeRuns).toBe(1);
  });

  it('works with maxConcurrentRuns of 0', () => {
    const guard = createConcurrencyGuard(0);
    expect(guard.maxConcurrentRuns).toBe(0);
    expect(guard.available).toBe(0);
    expect(guard.tryAcquire()).toBe(false);
  });

  it('handles many acquire/release cycles', () => {
    const guard = createConcurrencyGuard(3);
    for (let i = 0; i < 100; i++) {
      guard.tryAcquire();
      guard.release();
    }
    expect(guard.activeRuns).toBe(0);
    expect(guard.available).toBe(3);
  });
});
