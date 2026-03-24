import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from '@/tools/circuit-breaker';
import type { CircuitState } from '@/tools/circuit-breaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 1000, successThreshold: 2 });
  });

  describe('initial state', () => {
    it('starts in CLOSED state for unknown tools', () => {
      const state = cb.getState('test_tool');
      expect(state.state).toBe('CLOSED');
      expect(state.failures).toBe(0);
      expect(state.successes).toBe(0);
      expect(state.lastFailure).toBeNull();
      expect(state.lastSuccess).toBeNull();
      expect(state.openedAt).toBeNull();
    });

    it('allows execution in CLOSED state', () => {
      const result = cb.canExecute('test_tool');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('recordSuccess', () => {
    it('resets failure count on success in CLOSED state', () => {
      cb.recordFailure('test_tool', 'err1');
      cb.recordFailure('test_tool', 'err2');
      expect(cb.getState('test_tool').failures).toBe(2);

      cb.recordSuccess('test_tool');
      expect(cb.getState('test_tool').failures).toBe(0);
      expect(cb.getState('test_tool').lastSuccess).not.toBeNull();
    });
  });

  describe('recordFailure', () => {
    it('increments failure count', () => {
      cb.recordFailure('test_tool', 'err1');
      expect(cb.getState('test_tool').failures).toBe(1);

      cb.recordFailure('test_tool', 'err2');
      expect(cb.getState('test_tool').failures).toBe(2);
    });

    it('opens circuit after reaching failure threshold', () => {
      cb.recordFailure('test_tool', 'err1');
      cb.recordFailure('test_tool', 'err2');
      cb.recordFailure('test_tool', 'err3');

      const state = cb.getState('test_tool');
      expect(state.state).toBe('OPEN');
      expect(state.openedAt).not.toBeNull();
    });

    it('blocks execution when circuit is OPEN', () => {
      cb.recordFailure('test_tool', 'err1');
      cb.recordFailure('test_tool', 'err2');
      cb.recordFailure('test_tool', 'err3');

      const result = cb.canExecute('test_tool');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Circuit breaker OPEN');
      expect(result.reason).toContain('test_tool');
    });
  });

  describe('OPEN -> HALF_OPEN transition', () => {
    it('transitions to HALF_OPEN after reset timeout', () => {
      cb.recordFailure('test_tool', 'err1');
      cb.recordFailure('test_tool', 'err2');
      cb.recordFailure('test_tool', 'err3');

      expect(cb.getState('test_tool').state).toBe('OPEN');

      // Simulate time passing
      vi.useFakeTimers();
      vi.advanceTimersByTime(1001);

      const result = cb.canExecute('test_tool');
      expect(result.allowed).toBe(true);
      expect(cb.getState('test_tool').state).toBe('HALF_OPEN');

      vi.useRealTimers();
    });
  });

  describe('HALF_OPEN state', () => {
    function goToHalfOpen(toolName: string) {
      cb.recordFailure(toolName, 'err1');
      cb.recordFailure(toolName, 'err2');
      cb.recordFailure(toolName, 'err3');

      vi.useFakeTimers();
      vi.advanceTimersByTime(1001);
      cb.canExecute(toolName); // triggers transition
    }

    it('closes circuit after enough successes in HALF_OPEN', () => {
      goToHalfOpen('test_tool');
      expect(cb.getState('test_tool').state).toBe('HALF_OPEN');

      cb.recordSuccess('test_tool');
      expect(cb.getState('test_tool').state).toBe('HALF_OPEN');

      cb.recordSuccess('test_tool');
      expect(cb.getState('test_tool').state).toBe('CLOSED');
      expect(cb.getState('test_tool').failures).toBe(0);
      expect(cb.getState('test_tool').openedAt).toBeNull();

      vi.useRealTimers();
    });

    it('reopens circuit on failure in HALF_OPEN', () => {
      goToHalfOpen('test_tool');
      expect(cb.getState('test_tool').state).toBe('HALF_OPEN');

      cb.recordFailure('test_tool', 'err_half_open');
      expect(cb.getState('test_tool').state).toBe('OPEN');

      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('resets a specific tool circuit', () => {
      cb.recordFailure('test_tool', 'err1');
      cb.recordFailure('test_tool', 'err2');
      expect(cb.getState('test_tool').failures).toBe(2);

      cb.reset('test_tool');
      expect(cb.getState('test_tool').state).toBe('CLOSED');
      expect(cb.getState('test_tool').failures).toBe(0);
    });

    it('resetAll clears all circuits', () => {
      cb.recordFailure('tool_a', 'err1');
      cb.recordFailure('tool_b', 'err1');

      cb.resetAll();

      // getAllStates should be empty immediately after resetAll
      expect(cb.getAllStates().size).toBe(0);
      // getState lazily re-creates entries with default values
      expect(cb.getState('tool_a').failures).toBe(0);
      expect(cb.getState('tool_b').failures).toBe(0);
    });
  });

  describe('getAllStates', () => {
    it('returns a snapshot of all circuit states', () => {
      cb.recordFailure('tool_a', 'err1');
      cb.recordSuccess('tool_b');

      const states = cb.getAllStates();
      expect(states.size).toBe(2);
      expect(states.get('tool_a')?.failures).toBe(1);
      expect(states.get('tool_b')?.lastSuccess).not.toBeNull();
    });

    it('returns copies that do not affect original circuits', () => {
      cb.recordFailure('tool_a', 'err1');
      const states = cb.getAllStates();
      const snapshot = states.get('tool_a')!;
      snapshot.failures = 100;

      expect(cb.getState('tool_a').failures).toBe(1);
    });
  });

  describe('per-tool isolation', () => {
    it('tracks circuits independently per tool name', () => {
      cb.recordFailure('tool_a', 'err1');
      cb.recordFailure('tool_a', 'err2');
      cb.recordFailure('tool_a', 'err3');

      expect(cb.canExecute('tool_a').allowed).toBe(false);
      expect(cb.canExecute('tool_b').allowed).toBe(true);
    });
  });

  describe('default config', () => {
    it('uses default config values when no config provided', () => {
      const defaultCb = new CircuitBreaker();
      // Default threshold is 3
      defaultCb.recordFailure('t', 'e');
      defaultCb.recordFailure('t', 'e');
      expect(defaultCb.canExecute('t').allowed).toBe(true);
      defaultCb.recordFailure('t', 'e');
      expect(defaultCb.canExecute('t').allowed).toBe(false);
    });
  });
});
