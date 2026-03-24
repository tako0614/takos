import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

import { toApiDeployment } from '@/services/deployment/store';
import type { PrismaDeployment } from '@/services/deployment/store';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

describe('toApiDeployment', () => {
  it('maps prisma deployment to API deployment format', () => {
    const prismaDeployment = {
      id: 'dep-1',
      serviceId: 'w-1',
      accountId: 'space-1',
      version: 3,
      artifactRef: 'worker-w-1-v3',
      bundleR2Key: 'deployments/w-1/3/bundle.js',
      bundleHash: 'sha256-abc',
      bundleSize: 5000,
      wasmR2Key: null,
      wasmHash: null,
      assetsManifest: null,
      runtimeConfigSnapshotJson: '{"compatibility_date":"2024-01-01"}',
      bindingsSnapshotEncrypted: null,
      envVarsSnapshotEncrypted: null,
      deployState: 'completed',
      currentStep: null,
      stepError: null,
      status: 'success',
      routingStatus: 'active',
      routingWeight: 100,
      deployedBy: 'user-1',
      deployMessage: 'Fix bug',
      providerName: 'cloudflare',
      targetJson: '{}',
      providerStateJson: '{}',
      idempotencyKey: 'idem-1',
      isRollback: false,
      rollbackFromVersion: null,
      rolledBackAt: null,
      rolledBackBy: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:01:00.000Z',
    } as unknown as PrismaDeployment;

    const result = toApiDeployment(prismaDeployment);

    expect(result.id).toBe('dep-1');
    expect(result.service_id).toBe('w-1');
    expect(result.worker_id).toBeUndefined();
    expect(result.space_id).toBe('space-1');
    expect(result.version).toBe(3);
    expect(result.artifact_ref).toBe('worker-w-1-v3');
    expect(result.bundle_r2_key).toBe('deployments/w-1/3/bundle.js');
    expect(result.bundle_hash).toBe('sha256-abc');
    expect(result.bundle_size).toBe(5000);
    expect(result.status).toBe('success');
    expect(result.routing_status).toBe('active');
    expect(result.routing_weight).toBe(100);
    expect(result.deployed_by).toBe('user-1');
    expect(result.deploy_message).toBe('Fix bug');
    expect(result.provider_name).toBe('cloudflare');
    expect(result.idempotency_key).toBe('idem-1');
    expect(result.is_rollback).toBe(false);
  });

  it('handles null dates', () => {
    const prismaDeployment = {
      id: 'dep-1',
      serviceId: 'w-1',
      accountId: 'space-1',
      version: 1,
      artifactRef: null,
      bundleR2Key: null,
      bundleHash: null,
      bundleSize: null,
      wasmR2Key: null,
      wasmHash: null,
      assetsManifest: null,
      runtimeConfigSnapshotJson: '{}',
      bindingsSnapshotEncrypted: null,
      envVarsSnapshotEncrypted: null,
      deployState: 'pending',
      currentStep: null,
      stepError: null,
      status: 'pending',
      routingStatus: 'active',
      routingWeight: 100,
      deployedBy: null,
      deployMessage: null,
      providerName: 'cloudflare',
      targetJson: '{}',
      providerStateJson: '{}',
      idempotencyKey: null,
      isRollback: false,
      rollbackFromVersion: null,
      rolledBackAt: null,
      rolledBackBy: null,
      startedAt: null,
      completedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as unknown as PrismaDeployment;

    const result = toApiDeployment(prismaDeployment);

    expect(result.service_id).toBe('w-1');
    expect(result.rolled_back_at).toBeNull();
    expect(result.completed_at).toBeNull();
    expect(result.deployed_by).toBeNull();
  });
});

describe('getDeploymentById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when deployment not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const { getDeploymentById } = await import('@/services/deployment/store');
    const result = await getDeploymentById({} as any, 'nonexistent');

    expect(result).toBeNull();
  });
});

describe('getDeploymentHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns mapped deployments ordered by version desc', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValue([
      {
        id: 'dep-2',
        serviceId: 'w-1',
        accountId: 'space-1',
        version: 2,
        artifactRef: 'worker-w-1-v2',
        bundleR2Key: null,
        bundleHash: null,
        bundleSize: null,
        wasmR2Key: null,
        wasmHash: null,
        assetsManifest: null,
        runtimeConfigSnapshotJson: '{}',
        bindingsSnapshotEncrypted: null,
        envVarsSnapshotEncrypted: null,
        deployState: 'completed',
        currentStep: null,
        stepError: null,
        status: 'success',
        routingStatus: 'active',
        routingWeight: 100,
        deployedBy: null,
        deployMessage: null,
        providerName: 'cloudflare',
        targetJson: '{}',
        providerStateJson: '{}',
        idempotencyKey: null,
        isRollback: false,
        rollbackFromVersion: null,
        rolledBackAt: null,
        rolledBackBy: null,
        startedAt: null,
        completedAt: null,
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]);
    mocks.getDb.mockReturnValue(drizzle);

    const { getDeploymentHistory } = await import('@/services/deployment/store');
    const result = await getDeploymentHistory({} as any, 'w-1', 10);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('dep-2');
    expect(result[0].version).toBe(2);
  });
});

describe('getServiceDeploymentBasics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns exists: false when worker not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue(undefined);
    mocks.getDb.mockReturnValue(drizzle);

    const { getServiceDeploymentBasics } = await import('@/services/deployment/store');
    const result = await getServiceDeploymentBasics({} as any, 'nonexistent');

    expect(result.exists).toBe(false);
    expect(result.id).toBe('nonexistent');
    expect(result.hostname).toBeNull();
    expect(result.activeDeploymentId).toBeNull();
  });

  it('returns worker info when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValue({
      id: 'w-1',
      hostname: 'test.example.com',
      activeDeploymentId: 'dep-1',
    });
    mocks.getDb.mockReturnValue(drizzle);

    const { getServiceDeploymentBasics } = await import('@/services/deployment/store');
    const result = await getServiceDeploymentBasics({} as any, 'w-1');

    expect(result.exists).toBe(true);
    expect(result.hostname).toBe('test.example.com');
    expect(result.activeDeploymentId).toBe('dep-1');
  });
});
