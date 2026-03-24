import { describe, expect, it, vi } from 'vitest';
import {
  createInitialState,
  asDurableObjectFetcher,
  type JobExecutionState,
  type ConditionContext,
  type ExpressionContext,
  type StepExecutionContext,
  type StepExecutionResult,
  type RuntimeStepResponse,
  type RunContext,
  type WorkflowQueueEnv,
  type JobContext,
  type JobCompletedEventData,
  type JobStartedEventData,
  type QueueBatchMessage,
} from '@/queues/workflow-types';

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------

describe('createInitialState', () => {
  it('returns a fresh state with default values', () => {
    const state = createInitialState();

    expect(state.jobConclusion).toBe('success');
    expect(state.runtimeStarted).toBe(false);
    expect(state.runtimeCancelled).toBe(false);
    expect(state.runtimeWorkspaceId).toBeNull();
    expect(state.completionConclusion).toBeNull();
    expect(state.logs).toEqual([]);
    expect(state.stepResults).toEqual([]);
    expect(state.stepOutputs).toEqual({});
  });

  it('returns independent instances on each call', () => {
    const state1 = createInitialState();
    const state2 = createInitialState();

    state1.logs.push('test');
    state1.jobConclusion = 'failure';

    expect(state2.logs).toEqual([]);
    expect(state2.jobConclusion).toBe('success');
  });

  it('allows mutation of returned state', () => {
    const state = createInitialState();

    state.jobConclusion = 'failure';
    state.runtimeStarted = true;
    state.runtimeCancelled = true;
    state.runtimeWorkspaceId = 'ws-123';
    state.completionConclusion = 'success';
    state.logs.push('log entry');
    state.stepResults.push({
      stepNumber: 1,
      name: 'test',
      status: 'completed',
      conclusion: 'success',
      outputs: {},
    });
    state.stepOutputs['step1'] = { key: 'value' };

    expect(state.jobConclusion).toBe('failure');
    expect(state.runtimeStarted).toBe(true);
    expect(state.runtimeCancelled).toBe(true);
    expect(state.runtimeWorkspaceId).toBe('ws-123');
    expect(state.completionConclusion).toBe('success');
    expect(state.logs).toHaveLength(1);
    expect(state.stepResults).toHaveLength(1);
    expect(state.stepOutputs['step1']).toEqual({ key: 'value' });
  });
});

// ---------------------------------------------------------------------------
// asDurableObjectFetcher
// ---------------------------------------------------------------------------

describe('asDurableObjectFetcher', () => {
  it('casts any object to DurableObjectFetchLike', () => {
    const stub = {
      fetch: async () => new Response('ok'),
    };
    const fetcher = asDurableObjectFetcher(stub);
    expect(fetcher).toBe(stub);
    expect(typeof fetcher.fetch).toBe('function');
  });

  it('casts null without throwing', () => {
    const fetcher = asDurableObjectFetcher(null);
    expect(fetcher).toBeNull();
  });

  it('casts a mock DO stub', () => {
    const mockStub = {
      fetch: vi.fn().mockResolvedValue(new Response('{"ok":true}')),
    };
    const fetcher = asDurableObjectFetcher(mockStub);
    expect(fetcher.fetch).toBe(mockStub.fetch);
  });
});
