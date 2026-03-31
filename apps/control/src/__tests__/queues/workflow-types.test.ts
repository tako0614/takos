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
  type JobQueueContext,
  type JobCompletedEventData,
  type JobStartedEventData,
  type QueueBatchMessage,
} from '@/queues/workflow-types';

// ---------------------------------------------------------------------------
// createInitialState
// ---------------------------------------------------------------------------


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('createInitialState - returns a fresh state with default values', () => {
  const state = createInitialState();

    assertEquals(state.jobConclusion, 'success');
    assertEquals(state.runtimeStarted, false);
    assertEquals(state.runtimeCancelled, false);
    assertEquals(state.runtimeSpaceId, null);
    assertEquals(state.completionConclusion, null);
    assertEquals(state.logs, []);
    assertEquals(state.stepResults, []);
    assertEquals(state.stepOutputs, {});
})
  Deno.test('createInitialState - returns independent instances on each call', () => {
  const state1 = createInitialState();
    const state2 = createInitialState();

    state1.logs.push('test');
    state1.jobConclusion = 'failure';

    assertEquals(state2.logs, []);
    assertEquals(state2.jobConclusion, 'success');
})
  Deno.test('createInitialState - allows mutation of returned state', () => {
  const state = createInitialState();

    state.jobConclusion = 'failure';
    state.runtimeStarted = true;
    state.runtimeCancelled = true;
    state.runtimeSpaceId = 'ws-123';
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

    assertEquals(state.jobConclusion, 'failure');
    assertEquals(state.runtimeStarted, true);
    assertEquals(state.runtimeCancelled, true);
    assertEquals(state.runtimeSpaceId, 'ws-123');
    assertEquals(state.completionConclusion, 'success');
    assertEquals(state.logs.length, 1);
    assertEquals(state.stepResults.length, 1);
    assertEquals(state.stepOutputs['step1'], { key: 'value' });
})
// ---------------------------------------------------------------------------
// asDurableObjectFetcher
// ---------------------------------------------------------------------------


  Deno.test('asDurableObjectFetcher - casts any object to DurableObjectFetchLike', () => {
  const stub = {
      fetch: async () => new Response('ok'),
    };
    const fetcher = asDurableObjectFetcher(stub);
    assertEquals(fetcher, stub);
    assertEquals(typeof fetcher.fetch, 'function');
})
  Deno.test('asDurableObjectFetcher - casts null without throwing', () => {
  const fetcher = asDurableObjectFetcher(null);
    assertEquals(fetcher, null);
})
  Deno.test('asDurableObjectFetcher - casts a mock DO stub', () => {
  const mockStub = {
      fetch: (async () => new Response('{"ok":true}')),
    };
    const fetcher = asDurableObjectFetcher(mockStub);
    assertEquals(fetcher.fetch, mockStub.fetch);
})