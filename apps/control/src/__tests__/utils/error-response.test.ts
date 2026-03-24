import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import {
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  internalError,
  serviceUnavailable,
  paymentRequired,
  gone,
  payloadTooLarge,
  rateLimited,
  notImplemented,
  badGateway,
  gatewayTimeout,
  handleDbError,
  oauth2Error,
} from '@/utils/error-response';

// Helper: create a minimal Hono context by running a request through a Hono app
async function runWithContext(
  handler: (c: any) => Response | Promise<Response>
): Promise<{ status: number; body: any; headers: Headers }> {
  const app = new Hono();
  app.get('/test', (c) => handler(c));
  const res = await app.request('/test');
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

describe('errorResponse', () => {
  it('returns JSON with error message', async () => {
    const { status, body } = await runWithContext((c) =>
      errorResponse(c, 400, 'Bad input')
    );
    expect(status).toBe(400);
    expect(body.error).toBe('Bad input');
  });

  it('includes code when provided', async () => {
    const { body } = await runWithContext((c) =>
      errorResponse(c, 400, 'Bad', 'MY_CODE')
    );
    expect(body.code).toBe('MY_CODE');
  });

  it('includes details when provided', async () => {
    const { body } = await runWithContext((c) =>
      errorResponse(c, 400, 'Bad', 'CODE', { field: 'name' })
    );
    expect(body.details).toEqual({ field: 'name' });
  });

  it('omits code and details when not provided', async () => {
    const { body } = await runWithContext((c) =>
      errorResponse(c, 500, 'Error')
    );
    expect(body.code).toBeUndefined();
    expect(body.details).toBeUndefined();
  });
});

describe('badRequest', () => {
  it('returns 400 with BAD_REQUEST code', async () => {
    const { status, body } = await runWithContext((c) =>
      badRequest(c, 'Invalid field')
    );
    expect(status).toBe(400);
    expect(body.code).toBe('BAD_REQUEST');
    expect(body.error).toBe('Invalid field');
  });
});

describe('unauthorized', () => {
  it('returns 401 with default message', async () => {
    const { status, body } = await runWithContext((c) => unauthorized(c));
    expect(status).toBe(401);
    expect(body.error).toBe('Authentication required');
  });

  it('accepts custom message', async () => {
    const { body } = await runWithContext((c) => unauthorized(c, 'Token expired'));
    expect(body.error).toBe('Token expired');
  });
});

describe('forbidden', () => {
  it('returns 403 with default message', async () => {
    const { status, body } = await runWithContext((c) => forbidden(c));
    expect(status).toBe(403);
    expect(body.error).toBe('Access denied');
  });
});

describe('notFound', () => {
  it('returns 404 with resource name', async () => {
    const { status, body } = await runWithContext((c) => notFound(c, 'User'));
    expect(status).toBe(404);
    expect(body.error).toBe('User not found');
  });

  it('uses default "Resource" when not specified', async () => {
    const { body } = await runWithContext((c) => notFound(c));
    expect(body.error).toBe('Resource not found');
  });
});

describe('conflict', () => {
  it('returns 409', async () => {
    const { status, body } = await runWithContext((c) =>
      conflict(c, 'Already exists')
    );
    expect(status).toBe(409);
    expect(body.code).toBe('CONFLICT');
  });
});

describe('validationError', () => {
  it('returns 422', async () => {
    const { status, body } = await runWithContext((c) =>
      validationError(c, 'Invalid data', { fields: ['name'] })
    );
    expect(status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details).toEqual({ fields: ['name'] });
  });
});

describe('internalError', () => {
  it('returns 500 with default message', async () => {
    const { status, body } = await runWithContext((c) => internalError(c));
    expect(status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });
});

describe('serviceUnavailable', () => {
  it('returns 503', async () => {
    const { status, body } = await runWithContext((c) => serviceUnavailable(c));
    expect(status).toBe(503);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('paymentRequired', () => {
  it('returns 402', async () => {
    const { status, body } = await runWithContext((c) => paymentRequired(c));
    expect(status).toBe(402);
    expect(body.code).toBe('PAYMENT_REQUIRED');
  });
});

describe('gone', () => {
  it('returns 410', async () => {
    const { status, body } = await runWithContext((c) => gone(c));
    expect(status).toBe(410);
    expect(body.code).toBe('GONE');
  });
});

describe('payloadTooLarge', () => {
  it('returns 413', async () => {
    const { status, body } = await runWithContext((c) =>
      payloadTooLarge(c, 'File too big', { maxSize: 10485760 })
    );
    expect(status).toBe(413);
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('rateLimited', () => {
  it('returns 429 with RATE_LIMITED code', async () => {
    const { status, body } = await runWithContext((c) => rateLimited(c, 30));
    expect(status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
    expect(body.error).toBe('Rate limit exceeded');
  });

  it('returns 429 without retryAfter', async () => {
    const { status, body } = await runWithContext((c) => rateLimited(c));
    expect(status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
  });
});

describe('notImplemented', () => {
  it('returns 501', async () => {
    const { status, body } = await runWithContext((c) => notImplemented(c));
    expect(status).toBe(501);
    expect(body.code).toBe('NOT_IMPLEMENTED');
  });
});

describe('badGateway', () => {
  it('returns 502', async () => {
    const { status, body } = await runWithContext((c) => badGateway(c));
    expect(status).toBe(502);
    expect(body.code).toBe('BAD_GATEWAY');
  });
});

describe('gatewayTimeout', () => {
  it('returns 504', async () => {
    const { status, body } = await runWithContext((c) => gatewayTimeout(c));
    expect(status).toBe(504);
    expect(body.code).toBe('GATEWAY_TIMEOUT');
  });
});

describe('handleDbError', () => {
  it('returns 409 for UNIQUE constraint errors', async () => {
    const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('UNIQUE constraint failed: users.email'), 'User')
    );
    expect(status).toBe(409);
    expect(body.error).toBe('User already exists');
  });

  it('returns 400 for FOREIGN KEY constraint errors', async () => {
    const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('FOREIGN KEY constraint failed'), 'User')
    );
    expect(status).toBe(400);
    expect(body.error).toContain('user does not exist');
  });

  it('returns 422 for NOT NULL constraint errors', async () => {
    const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('NOT NULL constraint failed: users.name'))
    );
    expect(status).toBe(422);
    expect(body.error).toBe('Required field is missing');
  });

  it('returns 500 for unknown database errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('Connection timeout'))
    );
    expect(status).toBe(500);
    expect(body.error).toBe('Database operation failed');
    spy.mockRestore();
  });

  it('uses default entity name "Record"', async () => {
    const { body } = await runWithContext((c) =>
      handleDbError(c, new Error('UNIQUE constraint failed'))
    );
    expect(body.error).toBe('Record already exists');
  });
});

describe('oauth2Error', () => {
  it('returns error in OAuth2 format', async () => {
    const { status, body } = await runWithContext((c) =>
      oauth2Error(c, 400, 'invalid_grant', 'Grant expired')
    );
    expect(status).toBe(400);
    expect(body.error).toBe('invalid_grant');
    expect(body.error_description).toBe('Grant expired');
  });

  it('omits description when not provided', async () => {
    const { body } = await runWithContext((c) =>
      oauth2Error(c, 401, 'invalid_client')
    );
    expect(body.error).toBe('invalid_client');
    expect(body.error_description).toBeUndefined();
  });
});
