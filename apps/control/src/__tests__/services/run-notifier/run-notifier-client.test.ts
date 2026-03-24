import { describe, expect, it } from 'vitest';
import { buildRunNotifierEmitRequest } from '@/services/run-notifier/run-notifier-client';
import { buildRunNotifierEmitPayload } from '@/services/run-notifier/run-notifier-payload';

describe('run-notifier-client helper', () => {
  it('builds a POST request for /emit', async () => {
    const payload = buildRunNotifierEmitPayload(
      'run-1',
      'run.failed',
      { status: 'failed' },
      10,
    );
    const request: Request = buildRunNotifierEmitRequest(payload);

    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://internal.do/emit');
    expect(request.headers.get('Content-Type')).toBe('application/json');
    expect(await request.json()).toEqual(payload);
  });
});
