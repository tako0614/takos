import { createMockEnv } from '../../../test/integration/setup.ts';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  hashAuditIp: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/common-env/audit'
import { buildCommonEnvActor } from '@/routes/common-env-handlers';


  Deno.test('buildCommonEnvActor - builds actor from request headers', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.hashAuditIp = (async () => 'hashed-ip') as any;
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

    assertEquals(actor, {
      type: 'user',
      userId: 'user-1',
      requestId: 'req-123',
      ipHash: 'hashed-ip',
      userAgent: 'TestAgent/1.0',
    });
    assertSpyCallArgs(mocks.hashAuditIp, 0, [env, '1.2.3.4']);
})
  Deno.test('buildCommonEnvActor - handles missing headers gracefully', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.hashAuditIp = (async () => 'hashed-ip') as any;
  const env = createMockEnv();
    const mockContext = {
      req: {
        header: () => undefined,
      },
      env,
    };

    const actor = await buildCommonEnvActor(mockContext as any, 'user-1');

    assertEquals(actor.type, 'user');
    assertEquals(actor.userId, 'user-1');
    assertEquals(actor.requestId, undefined);
    assertEquals(actor.userAgent, undefined);
})
  Deno.test('buildCommonEnvActor - uses x-forwarded-for when cf-connecting-ip is not present', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.hashAuditIp = (async () => 'hashed-ip') as any;
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

    assertSpyCallArgs(mocks.hashAuditIp, 0, [env, '5.6.7.8']);
})
  Deno.test('buildCommonEnvActor - uses cf-ray as fallback for request ID', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
    mocks.hashAuditIp = (async () => 'hashed-ip') as any;
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

    assertEquals(actor.requestId, 'ray-456');
})