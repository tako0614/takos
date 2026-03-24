import { describe, expect, it } from 'vitest';
import { ServiceCallError, parseServiceResponse } from '@/utils/service-client';

describe('ServiceCallError', () => {
  it('creates error with mapped status code for 404', () => {
    const err = new ServiceCallError({
      serviceName: 'test-service',
      upstreamStatus: 404,
    });
    expect(err.message).toBe('test-service returned 404');
    expect(err.name).toBe('ServiceCallError');
    expect(err.serviceName).toBe('test-service');
    expect(err.upstreamStatus).toBe(404);
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('maps 400 to BAD_REQUEST', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 400 });
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.statusCode).toBe(400);
  });

  it('maps 401 to UNAUTHORIZED', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 401 });
    expect(err.code).toBe('UNAUTHORIZED');
  });

  it('maps 403 to FORBIDDEN', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 403 });
    expect(err.code).toBe('FORBIDDEN');
  });

  it('maps 409 to CONFLICT', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 409 });
    expect(err.code).toBe('CONFLICT');
  });

  it('maps 429 to RATE_LIMITED', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 429 });
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('maps 503 to SERVICE_UNAVAILABLE', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 503 });
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('maps 422 to VALIDATION_ERROR', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 422 });
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(422);
  });

  it('maps 502 to BAD_GATEWAY', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 502 });
    expect(err.code).toBe('BAD_GATEWAY');
    expect(err.statusCode).toBe(502);
  });

  it('maps 504 to GATEWAY_TIMEOUT', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 504 });
    expect(err.code).toBe('GATEWAY_TIMEOUT');
    expect(err.statusCode).toBe(504);
  });

  it('maps unknown 4xx to BAD_REQUEST/400', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 418 });
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.statusCode).toBe(400);
  });

  it('maps unknown 5xx to INTERNAL_ERROR/500', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 599 });
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.statusCode).toBe(500);
  });

  it('uses custom message when provided', () => {
    const err = new ServiceCallError({
      serviceName: 'svc',
      upstreamStatus: 500,
      message: 'Custom failure message',
    });
    expect(err.message).toBe('Custom failure message');
  });

  it('stores upstream body and code', () => {
    const err = new ServiceCallError({
      serviceName: 'svc',
      upstreamStatus: 400,
      upstreamBody: '{"error":"bad"}',
      upstreamCode: 'VALIDATION',
    });
    expect(err.upstreamBody).toBe('{"error":"bad"}');
    expect(err.upstreamCode).toBe('VALIDATION');
  });

  it('is an instance of Error', () => {
    const err = new ServiceCallError({ serviceName: 'svc', upstreamStatus: 500 });
    expect(err).toBeInstanceOf(Error);
  });
});

describe('parseServiceResponse', () => {
  it('parses JSON from successful response', async () => {
    const res = new Response(JSON.stringify({ data: 'ok' }), { status: 200 });
    const result = await parseServiceResponse<{ data: string }>(res, 'test-svc');
    expect(result).toEqual({ data: 'ok' });
  });

  it('returns undefined for 204 No Content', async () => {
    const res = new Response(null, { status: 204 });
    const result = await parseServiceResponse(res, 'test-svc');
    expect(result).toBeUndefined();
  });

  it('returns undefined for 205 Reset Content', async () => {
    const res = new Response(null, { status: 205 });
    const result = await parseServiceResponse(res, 'test-svc');
    expect(result).toBeUndefined();
  });

  it('returns undefined for empty body on 200', async () => {
    const res = new Response('', { status: 200 });
    const result = await parseServiceResponse(res, 'test-svc');
    expect(result).toBeUndefined();
  });

  it('returns undefined for whitespace-only body on 200', async () => {
    const res = new Response('   ', { status: 200 });
    const result = await parseServiceResponse(res, 'test-svc');
    expect(result).toBeUndefined();
  });

  it('throws ServiceCallError for malformed JSON on success', async () => {
    const res = new Response('not json', { status: 200 });
    await expect(parseServiceResponse(res, 'test-svc')).rejects.toThrow(ServiceCallError);
    try {
      await parseServiceResponse(new Response('bad', { status: 200 }), 'test-svc');
    } catch (e) {
      expect((e as ServiceCallError).message).toContain('malformed JSON');
    }
  });

  it('throws ServiceCallError for 4xx responses', async () => {
    const res = new Response(JSON.stringify({ error: { code: 'VALIDATION' } }), { status: 400 });
    try {
      await parseServiceResponse(res, 'test-svc');
      expect.unreachable('Should have thrown');
    } catch (e) {
      const err = e as ServiceCallError;
      expect(err).toBeInstanceOf(ServiceCallError);
      expect(err.upstreamStatus).toBe(400);
      expect(err.upstreamCode).toBe('VALIDATION');
    }
  });

  it('throws ServiceCallError for 5xx responses', async () => {
    const res = new Response('Internal Server Error', { status: 500 });
    await expect(parseServiceResponse(res, 'test-svc')).rejects.toThrow(ServiceCallError);
  });

  it('handles non-JSON error body gracefully', async () => {
    const res = new Response('<html>Error</html>', { status: 500 });
    try {
      await parseServiceResponse(res, 'test-svc');
      expect.unreachable('Should have thrown');
    } catch (e) {
      const err = e as ServiceCallError;
      expect(err.upstreamBody).toBe('<html>Error</html>');
      expect(err.upstreamCode).toBeUndefined();
    }
  });
});
