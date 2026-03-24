import { describe, expect, it } from 'vitest';

import { ErrorCodes } from '@takos/common/errors';
import {
  parseServiceResponse,
  ServiceCallError,
} from '@/shared/utils/service-client';

describe('ServiceCallError', () => {
  it('keeps BAD_REQUEST/400 fallback for unmapped upstream 4xx statuses', () => {
    const error = new ServiceCallError({
      serviceName: 'profile-service',
      upstreamStatus: 418,
    });

    expect(error.code).toBe(ErrorCodes.BAD_REQUEST);
    expect(error.statusCode).toBe(400);
  });

  it('keeps INTERNAL_ERROR/500 fallback for unmapped upstream 5xx statuses', () => {
    const error = new ServiceCallError({
      serviceName: 'profile-service',
      upstreamStatus: 500,
    });

    expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(error.statusCode).toBe(500);
  });
});

describe('parseServiceResponse', () => {
  it('returns parsed JSON for 200 success responses', async () => {
    const res = new Response(JSON.stringify({ ok: true, value: 42 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(
      parseServiceResponse<{ ok: boolean; value: number }>(res, 'profile-service')
    ).resolves.toEqual({ ok: true, value: 42 });
  });

  it('returns undefined for 204 empty success responses', async () => {
    const res = new Response(null, { status: 204 });

    await expect(parseServiceResponse<undefined>(res, 'profile-service')).resolves.toBeUndefined();
  });

  it('throws ServiceCallError for malformed JSON on 2xx responses', async () => {
    expect.assertions(4);
    const res = new Response('{"ok":', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    try {
      await parseServiceResponse(res, 'profile-service');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceCallError);
      expect((error as ServiceCallError).upstreamStatus).toBe(200);
      expect((error as ServiceCallError).upstreamBody).toBe('{"ok":');
      expect((error as ServiceCallError).message).toContain('malformed JSON');
    }
  });

  it('extracts upstream error code for non-2xx responses', async () => {
    expect.assertions(4);
    const res = new Response(
      JSON.stringify({
        error: {
          code: 'UPSTREAM_TIMEOUT',
          message: 'Timeout while processing request',
        },
      }),
      {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }
    );

    try {
      await parseServiceResponse(res, 'payments-service');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceCallError);
      expect((error as ServiceCallError).upstreamStatus).toBe(503);
      expect((error as ServiceCallError).upstreamCode).toBe('UPSTREAM_TIMEOUT');
      expect((error as ServiceCallError).code).toBe(ErrorCodes.SERVICE_UNAVAILABLE);
    }
  });
});
