import { describe, expect, it } from 'vitest';
import { authenticateServiceRequest } from '@/routes/sessions/auth';

describe('authenticateServiceRequest', () => {
  it('accepts X-Takos-Internal requests with session headers', async () => {
    const payload = await authenticateServiceRequest({
      req: {
        header(name: string): string | undefined {
          if (name === 'X-Takos-Internal') return '1';
          if (name === 'X-Takos-Session-Id') return 'sess_123';
          if (name === 'X-Takos-Space-Id') return 'space_123';
          return undefined;
        },
      },
    } as never);

    expect(payload).toMatchObject({
      session_id: 'sess_123',
      space_id: 'space_123',
      sub: 'service',
    });
  });

  it('rejects requests without X-Takos-Internal header', async () => {
    const payload = await authenticateServiceRequest({
      req: {
        header(name: string): string | undefined {
          if (name === 'Authorization') return 'Bearer some-token';
          return undefined;
        },
      },
    } as never);

    expect(payload).toBeNull();
  });

  it('rejects legacy shared-secret headers', async () => {
    const payload = await authenticateServiceRequest({
      req: {
        header(name: string): string | undefined {
          if (name === 'X-Service-Token') {
            return 'legacy-token';
          }
          return undefined;
        },
      },
    } as never);

    expect(payload).toBeNull();
  });
});
