import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEnv } from '../../../test/integration/setup';

const mocks = vi.hoisted(() => ({
  hashAuditIp: vi.fn(),
}));

vi.mock('@/services/common-env/audit', () => ({
  hashAuditIp: mocks.hashAuditIp,
}));

import { buildCommonEnvActor } from '@/routes/common-env/helpers';

describe('buildCommonEnvActor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hashAuditIp.mockResolvedValue('hashed-ip');
  });

  it('builds actor from request headers', async () => {
    const env = createMockEnv();
    const mockContext = {
      req: {
        header: (name: string) => {
          const headers: Record<string, string> = {
            'x-request-id': 'req-123',
            'user-agent': 'TestAgent/1.0',
            'cf-connecting-ip': '1.2.3.4',
          };
          return headers[name.toLowerCase()];
        },
      },
      env,
    };

    const actor = await buildCommonEnvActor(mockContext as any, 'user-1');

    expect(actor).toEqual({
      type: 'user',
      userId: 'user-1',
      requestId: 'req-123',
      ipHash: 'hashed-ip',
      userAgent: 'TestAgent/1.0',
    });
    expect(mocks.hashAuditIp).toHaveBeenCalledWith(env, '1.2.3.4');
  });

  it('handles missing headers gracefully', async () => {
    const env = createMockEnv();
    const mockContext = {
      req: {
        header: () => undefined,
      },
      env,
    };

    const actor = await buildCommonEnvActor(mockContext as any, 'user-1');

    expect(actor.type).toBe('user');
    expect(actor.userId).toBe('user-1');
    expect(actor.requestId).toBeUndefined();
    expect(actor.userAgent).toBeUndefined();
  });

  it('uses x-forwarded-for when cf-connecting-ip is not present', async () => {
    const env = createMockEnv();
    const mockContext = {
      req: {
        header: (name: string) => {
          const headers: Record<string, string> = {
            'x-forwarded-for': '5.6.7.8, 9.10.11.12',
          };
          return headers[name.toLowerCase()];
        },
      },
      env,
    };

    await buildCommonEnvActor(mockContext as any, 'user-1');

    expect(mocks.hashAuditIp).toHaveBeenCalledWith(env, '5.6.7.8');
  });

  it('uses cf-ray as fallback for request ID', async () => {
    const env = createMockEnv();
    const mockContext = {
      req: {
        header: (name: string) => {
          if (name === 'cf-ray') return 'ray-456';
          return undefined;
        },
      },
      env,
    };

    const actor = await buildCommonEnvActor(mockContext as any, 'user-1');

    expect(actor.requestId).toBe('ray-456');
  });
});
