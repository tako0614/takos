import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  DeploymentService: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock('@/services/deployment', () => ({
  DeploymentService: mocks.DeploymentService,
}));

vi.mock('@/db', async () => {
  const actual = await vi.importActual<typeof import('@/db')>('@/db');
  return { ...actual, getDb: mocks.getDb };
});

import {
  isValidDeploymentQueueMessage,
  handleDeploymentJob,
  handleDeploymentJobDlq,
  type DeploymentQueueMessage,
} from '@/queues/deploy-jobs';

// ---------------------------------------------------------------------------
// Drizzle mock helper
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: {
  updateWhere?: ReturnType<typeof vi.fn>;
} = {}) {
  const updateWhere = opts.updateWhere ?? vi.fn().mockResolvedValue({ meta: { changes: 1 } });

  return {
    update: vi.fn().mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: updateWhere,
      }),
    })),
  };
}

function validDeployMessage(): DeploymentQueueMessage {
  return {
    version: 1,
    type: 'deployment',
    deploymentId: 'deploy-1',
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isValidDeploymentQueueMessage
// ---------------------------------------------------------------------------

describe('isValidDeploymentQueueMessage', () => {
  it('accepts valid deployment message', () => {
    expect(isValidDeploymentQueueMessage(validDeployMessage())).toBe(true);
  });

  it('rejects null', () => {
    expect(isValidDeploymentQueueMessage(null)).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidDeploymentQueueMessage(undefined)).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isValidDeploymentQueueMessage('string')).toBe(false);
    expect(isValidDeploymentQueueMessage(42)).toBe(false);
  });

  it('rejects wrong version', () => {
    expect(isValidDeploymentQueueMessage({ ...validDeployMessage(), version: 2 })).toBe(false);
  });

  it('rejects wrong type', () => {
    expect(isValidDeploymentQueueMessage({ ...validDeployMessage(), type: 'job' })).toBe(false);
  });

  it('rejects missing deploymentId', () => {
    const msg = { ...validDeployMessage() } as Record<string, unknown>;
    delete msg.deploymentId;
    expect(isValidDeploymentQueueMessage(msg)).toBe(false);
  });

  it('rejects non-string deploymentId', () => {
    expect(isValidDeploymentQueueMessage({ ...validDeployMessage(), deploymentId: 123 })).toBe(false);
  });

  it('rejects missing timestamp', () => {
    const msg = { ...validDeployMessage() } as Record<string, unknown>;
    delete msg.timestamp;
    expect(isValidDeploymentQueueMessage(msg)).toBe(false);
  });

  it('rejects non-number timestamp', () => {
    expect(isValidDeploymentQueueMessage({ ...validDeployMessage(), timestamp: 'now' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleDeploymentJob
// ---------------------------------------------------------------------------

describe('handleDeploymentJob', () => {
  it('calls executeDeployment on the deployment service', async () => {
    const executeDeployment = vi.fn().mockResolvedValue(undefined);
    mocks.DeploymentService.mockImplementation(() => ({ executeDeployment }));

    await handleDeploymentJob(validDeployMessage(), {} as any);

    expect(mocks.DeploymentService).toHaveBeenCalled();
    expect(executeDeployment).toHaveBeenCalledWith('deploy-1');
  });

  it('throws when executeDeployment fails (allowing queue retry)', async () => {
    const error = new Error('deployment failed');
    mocks.DeploymentService.mockImplementation(() => ({
      executeDeployment: vi.fn().mockRejectedValue(error),
    }));

    await expect(handleDeploymentJob(validDeployMessage(), {} as any)).rejects.toThrow('deployment failed');
  });
});

// ---------------------------------------------------------------------------
// handleDeploymentJobDlq
// ---------------------------------------------------------------------------

describe('handleDeploymentJobDlq', () => {
  it('marks deployment as failed when still in progress', async () => {
    const dbMock = createDrizzleMock();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.DeploymentService.mockImplementation(() => ({
      getDeploymentById: vi.fn().mockResolvedValue({ id: 'deploy-1', status: 'building' }),
    }));

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 5);

    expect(dbMock.update).toHaveBeenCalled();
  });

  it('does not update when deployment is already successful', async () => {
    const dbMock = createDrizzleMock();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.DeploymentService.mockImplementation(() => ({
      getDeploymentById: vi.fn().mockResolvedValue({ id: 'deploy-1', status: 'success' }),
    }));

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3);

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('does not update when deployment is already rolled_back', async () => {
    const dbMock = createDrizzleMock();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.DeploymentService.mockImplementation(() => ({
      getDeploymentById: vi.fn().mockResolvedValue({ id: 'deploy-1', status: 'rolled_back' }),
    }));

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3);

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('does not update when deployment is not found', async () => {
    const dbMock = createDrizzleMock();
    mocks.getDb.mockReturnValue(dbMock);
    mocks.DeploymentService.mockImplementation(() => ({
      getDeploymentById: vi.fn().mockResolvedValue(null),
    }));

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3);

    expect(dbMock.update).not.toHaveBeenCalled();
  });

  it('throws when deployment status update fails', async () => {
    mocks.DeploymentService.mockImplementation(() => ({
      getDeploymentById: vi.fn().mockRejectedValue(new Error('db read failed')),
    }));

    await expect(
      handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3)
    ).rejects.toThrow('db read failed');
  });

  it('updates with correct failure fields', async () => {
    const updateWhere = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const setFn = vi.fn().mockReturnValue({ where: updateWhere });
    const dbMock = {
      update: vi.fn().mockReturnValue({ set: setFn }),
    };
    mocks.getDb.mockReturnValue(dbMock);
    mocks.DeploymentService.mockImplementation(() => ({
      getDeploymentById: vi.fn().mockResolvedValue({ id: 'deploy-1', status: 'pending' }),
    }));

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 4);

    expect(setFn).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed',
      deployState: 'failed',
      stepError: expect.stringContaining('DLQ'),
    }));
  });
});
