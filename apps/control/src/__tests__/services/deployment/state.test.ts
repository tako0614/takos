import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateDeploymentRecord: vi.fn(),
  logDeploymentEvent: vi.fn(),
  getStuckDeployments: vi.fn(),
}));

vi.mock('@/services/deployment/store', () => ({
  updateDeploymentRecord: mocks.updateDeploymentRecord,
  logDeploymentEvent: mocks.logDeploymentEvent,
  getStuckDeployments: mocks.getStuckDeployments,
}));

import { updateDeploymentState, executeDeploymentStep, detectStuckDeployments, resetStuckDeployment } from '@/services/deployment/state';

describe('updateDeploymentState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDeploymentRecord.mockResolvedValue(undefined);
  });

  it('updates status and deploy state', async () => {
    await updateDeploymentState({} as any, 'dep-1', 'in_progress', 'deploying_worker');

    expect(mocks.updateDeploymentRecord).toHaveBeenCalledWith(
      expect.anything(),
      'dep-1',
      expect.objectContaining({
        status: 'in_progress',
        deployState: 'deploying_worker',
      })
    );
  });

  it('includes updatedAt timestamp', async () => {
    await updateDeploymentState({} as any, 'dep-1', 'success', 'completed');

    const call = mocks.updateDeploymentRecord.mock.calls[0][2];
    expect(call.updatedAt).toBeDefined();
  });
});

describe('executeDeploymentStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDeploymentRecord.mockResolvedValue(undefined);
    mocks.logDeploymentEvent.mockResolvedValue(undefined);
  });

  it('executes a successful step', async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    await executeDeploymentStep({} as any, 'dep-1', 'deploying_worker', 'deploy_worker', action);

    expect(action).toHaveBeenCalledTimes(1);
    // Should log step_started and step_completed
    expect(mocks.logDeploymentEvent).toHaveBeenCalledTimes(2);
    expect(mocks.logDeploymentEvent).toHaveBeenCalledWith(
      expect.anything(), 'dep-1', 'step_started', 'deploy_worker', expect.any(String)
    );
    expect(mocks.logDeploymentEvent).toHaveBeenCalledWith(
      expect.anything(), 'dep-1', 'step_completed', 'deploy_worker', expect.any(String)
    );
  });

  it('logs failure and rethrows on action error', async () => {
    const error = new Error('deploy failed');
    const action = vi.fn().mockRejectedValue(error);

    await expect(
      executeDeploymentStep({} as any, 'dep-1', 'deploying_worker', 'deploy_worker', action)
    ).rejects.toThrow('deploy failed');

    expect(mocks.logDeploymentEvent).toHaveBeenCalledWith(
      expect.anything(), 'dep-1', 'step_failed', 'deploy_worker', 'deploy failed'
    );
    expect(mocks.updateDeploymentRecord).toHaveBeenCalledWith(
      expect.anything(),
      'dep-1',
      expect.objectContaining({ stepError: 'deploy failed' })
    );
  });

  it('records step name on start', async () => {
    const action = vi.fn().mockResolvedValue(undefined);

    await executeDeploymentStep({} as any, 'dep-1', 'routing', 'update_routing', action);

    // First updateDeploymentRecord call should set deployState and currentStep
    expect(mocks.updateDeploymentRecord).toHaveBeenCalledWith(
      expect.anything(),
      'dep-1',
      expect.objectContaining({
        deployState: 'routing',
        currentStep: 'update_routing',
        stepError: null,
      })
    );
  });
});

describe('detectStuckDeployments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stuck deployments using default timeout', async () => {
    const stuckDeps = [{ id: 'dep-1', current_step: 'deploying_worker' }];
    mocks.getStuckDeployments.mockResolvedValue(stuckDeps);

    const result = await detectStuckDeployments({} as any);

    expect(mocks.getStuckDeployments).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String) // cutoff ISO string
    );
    expect(result).toEqual(stuckDeps);
  });

  it('uses custom timeout', async () => {
    mocks.getStuckDeployments.mockResolvedValue([]);

    await detectStuckDeployments({} as any, 5 * 60 * 1000);

    expect(mocks.getStuckDeployments).toHaveBeenCalled();
  });
});

describe('resetStuckDeployment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDeploymentRecord.mockResolvedValue(undefined);
    mocks.logDeploymentEvent.mockResolvedValue(undefined);
  });

  it('marks deployment as failed with reason', async () => {
    await resetStuckDeployment({} as any, 'dep-1', 'stuck for too long');

    expect(mocks.updateDeploymentRecord).toHaveBeenCalledWith(
      expect.anything(),
      'dep-1',
      expect.objectContaining({
        status: 'failed',
        deployState: 'failed',
        stepError: 'stuck for too long',
      })
    );
    expect(mocks.logDeploymentEvent).toHaveBeenCalledWith(
      expect.anything(), 'dep-1', 'stuck_reset', null, 'stuck for too long'
    );
  });

  it('uses default reason', async () => {
    await resetStuckDeployment({} as any, 'dep-1');

    const call = mocks.updateDeploymentRecord.mock.calls[0][2];
    expect(call.stepError).toContain('timed out');
  });
});
