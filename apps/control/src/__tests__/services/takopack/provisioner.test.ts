import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createClient: vi.fn(),
  deleteClient: vi.fn(),
  ensureSystemCommonEnv: vi.fn(),
  now: vi.fn().mockReturnValue('2026-03-01T00:00:00.000Z'),
  safeJsonParseOrDefault: vi.fn((raw: string | null, fallback: unknown) => {
    if (!raw) return fallback;
    try { return JSON.parse(raw); } catch { return fallback; }
  }),
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
}));

vi.mock('@/services/oauth/client', () => ({
  createClient: mocks.createClient,
  deleteClient: mocks.deleteClient,
}));

vi.mock('@/services/common-env', () => ({
  CommonEnvService: class {
    ensureSystemCommonEnv = mocks.ensureSystemCommonEnv;
  },
}));

vi.mock('@/shared/utils', () => ({
  now: mocks.now,
  safeJsonParseOrDefault: mocks.safeJsonParseOrDefault,
}));

import {
  provisionOAuthClient,
} from '@/services/takopack/provisioner';
import { CompensationTracker } from '@/services/takopack/compensation';
import type { TakopackManifest, ResourceProvisionResult } from '@/services/takopack/types';

function createBaseManifest(oauth?: TakopackManifest['oauth']): TakopackManifest {
  return {
    manifestVersion: 'vnext-infra-v1alpha1',
    meta: {
      name: 'test-pack',
      appId: 'dev.takos.test',
      version: '1.0.0',
      createdAt: '2026-03-01T00:00:00.000Z',
    },
    oauth,
    objects: [],
  };
}

function createMockDb() {
  return {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  };
}

describe('provisionOAuthClient', () => {
  const mockEnv = { DB: {}, ADMIN_DOMAIN: 'test.takos.jp' } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(createMockDb());
  });

  it('returns empty result when manifest has no oauth section', async () => {
    const tracker = new CompensationTracker();
    const manifest = createBaseManifest();

    const result = await provisionOAuthClient({
      env: mockEnv,
      manifest,
      spaceId: 'ws-1',
      userId: 'user-1',
      hostname: 'test.app.takos.jp',
      bundleDeploymentId: 'tp-1',
      appBaseUrlForAutoEnv: null,
      tracker,
    });

    expect(result).toEqual({});
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('creates oauth client and returns clientId', async () => {
    mocks.createClient.mockResolvedValue({
      client_id: 'client-123',
      client_secret: 'secret-abc',
    });

    const tracker = new CompensationTracker();
    const manifest = createBaseManifest({
      clientName: 'Test App',
      redirectUris: ['https://test.app.takos.jp/oauth/callback'],
      scopes: ['openid'],
      autoEnv: false,
    });

    const result = await provisionOAuthClient({
      env: mockEnv,
      manifest,
      spaceId: 'ws-1',
      userId: 'user-1',
      hostname: 'test.app.takos.jp',
      bundleDeploymentId: 'tp-1',
      appBaseUrlForAutoEnv: null,
      tracker,
    });

    expect(result.clientId).toBe('client-123');
    expect(result.clientSecret).toBeUndefined(); // autoEnv is false
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });

  it('returns clientSecret when autoEnv is enabled', async () => {
    mocks.createClient.mockResolvedValue({
      client_id: 'client-123',
      client_secret: 'secret-abc',
    });

    const tracker = new CompensationTracker();
    const manifest = createBaseManifest({
      clientName: 'Test App',
      redirectUris: ['https://test.app.takos.jp/oauth/callback'],
      scopes: ['openid'],
      autoEnv: true,
    });

    const result = await provisionOAuthClient({
      env: mockEnv,
      manifest,
      spaceId: 'ws-1',
      userId: 'user-1',
      hostname: 'test.app.takos.jp',
      bundleDeploymentId: 'tp-1',
      appBaseUrlForAutoEnv: 'https://test.takos.jp',
      tracker,
    });

    expect(result.clientSecret).toBe('secret-abc');
  });

  it('substitutes HOSTNAME in redirect URIs', async () => {
    mocks.createClient.mockResolvedValue({
      client_id: 'client-123',
      client_secret: null,
    });

    const tracker = new CompensationTracker();
    const manifest = createBaseManifest({
      clientName: 'Test',
      redirectUris: ['https://${HOSTNAME}/callback'],
      scopes: ['openid'],
      autoEnv: false,
    });

    await provisionOAuthClient({
      env: mockEnv,
      manifest,
      spaceId: 'ws-1',
      userId: 'user-1',
      hostname: 'myapp.app.takos.jp',
      bundleDeploymentId: 'tp-1',
      appBaseUrlForAutoEnv: null,
      tracker,
    });

    const createCall = mocks.createClient.mock.calls[0];
    expect(createCall[1].redirect_uris).toEqual(['https://myapp.app.takos.jp/callback']);
  });

  it('throws for redirect URI that is not localhost or own hostname', async () => {
    const tracker = new CompensationTracker();
    const manifest = createBaseManifest({
      clientName: 'Test',
      redirectUris: ['https://evil.example.com/callback'],
      scopes: ['openid'],
      autoEnv: false,
    });

    await expect(
      provisionOAuthClient({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
        hostname: 'test.app.takos.jp',
        bundleDeploymentId: 'tp-1',
        appBaseUrlForAutoEnv: null,
        tracker,
      }),
    ).rejects.toThrow('Redirect URI not allowed');
  });

  it('allows localhost redirect URI for development', async () => {
    mocks.createClient.mockResolvedValue({
      client_id: 'client-123',
      client_secret: null,
    });

    const tracker = new CompensationTracker();
    const manifest = createBaseManifest({
      clientName: 'Test',
      redirectUris: ['http://localhost:3000/callback'],
      scopes: ['openid'],
      autoEnv: false,
    });

    await expect(
      provisionOAuthClient({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
        hostname: 'test.app.takos.jp',
        bundleDeploymentId: 'tp-1',
        appBaseUrlForAutoEnv: null,
        tracker,
      }),
    ).resolves.toBeDefined();
  });

  it('throws for invalid redirect URI', async () => {
    const tracker = new CompensationTracker();
    const manifest = createBaseManifest({
      clientName: 'Test',
      redirectUris: ['not-a-url'],
      scopes: ['openid'],
      autoEnv: false,
    });

    await expect(
      provisionOAuthClient({
        env: mockEnv,
        manifest,
        spaceId: 'ws-1',
        userId: 'user-1',
        hostname: 'test.app.takos.jp',
        bundleDeploymentId: 'tp-1',
        appBaseUrlForAutoEnv: null,
        tracker,
      }),
    ).rejects.toThrow('Invalid redirect URI');
  });

  it('adds compensation step for client cleanup', async () => {
    mocks.createClient.mockResolvedValue({
      client_id: 'client-123',
      client_secret: null,
    });

    const tracker = new CompensationTracker();
    const addSpy = vi.spyOn(tracker, 'add');

    const manifest = createBaseManifest({
      clientName: 'Test',
      redirectUris: ['https://test.app.takos.jp/cb'],
      scopes: ['openid'],
      autoEnv: false,
    });

    await provisionOAuthClient({
      env: mockEnv,
      manifest,
      spaceId: 'ws-1',
      userId: 'user-1',
      hostname: 'test.app.takos.jp',
      bundleDeploymentId: 'tp-1',
      appBaseUrlForAutoEnv: null,
      tracker,
    });

    expect(addSpy).toHaveBeenCalledWith('revoke oauth client', expect.any(Function));
  });

  it('calls ensureSystemCommonEnv when autoEnv is enabled with appBaseUrl', async () => {
    mocks.createClient.mockResolvedValue({
      client_id: 'client-123',
      client_secret: 'secret-abc',
    });

    const tracker = new CompensationTracker();
    const manifest = createBaseManifest({
      clientName: 'Test',
      redirectUris: ['https://test.app.takos.jp/cb'],
      scopes: ['openid'],
      autoEnv: true,
    });

    await provisionOAuthClient({
      env: mockEnv,
      manifest,
      spaceId: 'ws-1',
      userId: 'user-1',
      hostname: 'test.app.takos.jp',
      bundleDeploymentId: 'tp-1',
      appBaseUrlForAutoEnv: 'https://test.takos.jp',
      tracker,
    });

    expect(mocks.ensureSystemCommonEnv).toHaveBeenCalledWith('ws-1', [
      { name: 'APP_BASE_URL', value: 'https://test.takos.jp' },
    ]);
  });
});

