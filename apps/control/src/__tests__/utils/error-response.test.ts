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
import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';
import { stub } from 'jsr:@std/testing/mock';

async function runWithContext(
  handler: (c: any) => Response | Promise<Response>
): Promise<{ status: number; body: any; headers: Headers }> {
  const app = new Hono();
  app.get('/test', (c) => handler(c));
  const res = await app.request('/test');
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}


  Deno.test('errorResponse - returns JSON with error message', async () => {
  const { status, body } = await runWithContext((c) =>
      errorResponse(c, 400, 'Bad input')
    );
    assertEquals(status, 400);
    assertEquals(body.error, 'Bad input');
})
  Deno.test('errorResponse - includes code when provided', async () => {
  const { body } = await runWithContext((c) =>
      errorResponse(c, 400, 'Bad', 'MY_CODE')
    );
    assertEquals(body.code, 'MY_CODE');
})
  Deno.test('errorResponse - includes details when provided', async () => {
  const { body } = await runWithContext((c) =>
      errorResponse(c, 400, 'Bad', 'CODE', { field: 'name' })
    );
    assertEquals(body.details, { field: 'name' });
})
  Deno.test('errorResponse - omits code and details when not provided', async () => {
  const { body } = await runWithContext((c) =>
      errorResponse(c, 500, 'Error')
    );
    assertEquals(body.code, undefined);
    assertEquals(body.details, undefined);
})

  Deno.test('badRequest - returns 400 with BAD_REQUEST code', async () => {
  const { status, body } = await runWithContext((c) =>
      badRequest(c, 'Invalid field')
    );
    assertEquals(status, 400);
    assertEquals(body.code, 'BAD_REQUEST');
    assertEquals(body.error, 'Invalid field');
})

  Deno.test('unauthorized - returns 401 with default message', async () => {
  const { status, body } = await runWithContext((c) => unauthorized(c));
    assertEquals(status, 401);
    assertEquals(body.error, 'Authentication required');
})
  Deno.test('unauthorized - accepts custom message', async () => {
  const { body } = await runWithContext((c) => unauthorized(c, 'Token expired'));
    assertEquals(body.error, 'Token expired');
})

  Deno.test('forbidden - returns 403 with default message', async () => {
  const { status, body } = await runWithContext((c) => forbidden(c));
    assertEquals(status, 403);
    assertEquals(body.error, 'Access denied');
})

  Deno.test('notFound - returns 404 with resource name', async () => {
  const { status, body } = await runWithContext((c) => notFound(c, 'User'));
    assertEquals(status, 404);
    assertEquals(body.error, 'User not found');
})
  Deno.test('notFound - uses default "Resource" when not specified', async () => {
  const { body } = await runWithContext((c) => notFound(c));
    assertEquals(body.error, 'Resource not found');
})

  Deno.test('conflict - returns 409', async () => {
  const { status, body } = await runWithContext((c) =>
      conflict(c, 'Already exists')
    );
    assertEquals(status, 409);
    assertEquals(body.code, 'CONFLICT');
})

  Deno.test('validationError - returns 422', async () => {
  const { status, body } = await runWithContext((c) =>
      validationError(c, 'Invalid data', { fields: ['name'] })
    );
    assertEquals(status, 422);
    assertEquals(body.code, 'VALIDATION_ERROR');
    assertEquals(body.details, { fields: ['name'] });
})

  Deno.test('internalError - returns 500 with default message', async () => {
  const { status, body } = await runWithContext((c) => internalError(c));
    assertEquals(status, 500);
    assertEquals(body.error, 'Internal server error');
})

  Deno.test('serviceUnavailable - returns 503', async () => {
  const { status, body } = await runWithContext((c) => serviceUnavailable(c));
    assertEquals(status, 503);
    assertEquals(body.code, 'SERVICE_UNAVAILABLE');
})

  Deno.test('paymentRequired - returns 402', async () => {
  const { status, body } = await runWithContext((c) => paymentRequired(c));
    assertEquals(status, 402);
    assertEquals(body.code, 'PAYMENT_REQUIRED');
})

  Deno.test('gone - returns 410', async () => {
  const { status, body } = await runWithContext((c) => gone(c));
    assertEquals(status, 410);
    assertEquals(body.code, 'GONE');
})

  Deno.test('payloadTooLarge - returns 413', async () => {
  const { status, body } = await runWithContext((c) =>
      payloadTooLarge(c, 'File too big', { maxSize: 10485760 })
    );
    assertEquals(status, 413);
    assertEquals(body.code, 'PAYLOAD_TOO_LARGE');
})

  Deno.test('rateLimited - returns 429 with RATE_LIMITED code', async () => {
  const { status, body } = await runWithContext((c) => rateLimited(c, 30));
    assertEquals(status, 429);
    assertEquals(body.code, 'RATE_LIMITED');
    assertEquals(body.error, 'Rate limit exceeded');
})
  Deno.test('rateLimited - returns 429 without retryAfter', async () => {
  const { status, body } = await runWithContext((c) => rateLimited(c));
    assertEquals(status, 429);
    assertEquals(body.code, 'RATE_LIMITED');
})

  Deno.test('notImplemented - returns 501', async () => {
  const { status, body } = await runWithContext((c) => notImplemented(c));
    assertEquals(status, 501);
    assertEquals(body.code, 'NOT_IMPLEMENTED');
})

  Deno.test('badGateway - returns 502', async () => {
  const { status, body } = await runWithContext((c) => badGateway(c));
    assertEquals(status, 502);
    assertEquals(body.code, 'BAD_GATEWAY');
})

  Deno.test('gatewayTimeout - returns 504', async () => {
  const { status, body } = await runWithContext((c) => gatewayTimeout(c));
    assertEquals(status, 504);
    assertEquals(body.code, 'GATEWAY_TIMEOUT');
})

  Deno.test('handleDbError - returns 409 for UNIQUE constraint errors', async () => {
  const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('UNIQUE constraint failed: users.email'), 'User')
    );
    assertEquals(status, 409);
    assertEquals(body.error, 'User already exists');
})
  Deno.test('handleDbError - returns 400 for FOREIGN KEY constraint errors', async () => {
  const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('FOREIGN KEY constraint failed'), 'User')
    );
    assertEquals(status, 400);
    assertStringIncludes(body.error, 'user does not exist');
})
  Deno.test('handleDbError - returns 422 for NOT NULL constraint errors', async () => {
  const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('NOT NULL constraint failed: users.name'))
    );
    assertEquals(status, 422);
    assertEquals(body.error, 'Required field is missing');
})
  Deno.test('handleDbError - returns 500 for unknown database errors', async () => {
  const spy = stub(console, 'error') = () => {} as any;
    const { status, body } = await runWithContext((c) =>
      handleDbError(c, new Error('Connection timeout'))
    );
    assertEquals(status, 500);
    assertEquals(body.error, 'Database operation failed');
    spy.restore();
})
  Deno.test('handleDbError - uses default entity name "Record"', async () => {
  const { body } = await runWithContext((c) =>
      handleDbError(c, new Error('UNIQUE constraint failed'))
    );
    assertEquals(body.error, 'Record already exists');
})

  Deno.test('oauth2Error - returns error in OAuth2 format', async () => {
  const { status, body } = await runWithContext((c) =>
      oauth2Error(c, 400, 'invalid_grant', 'Grant expired')
    );
    assertEquals(status, 400);
    assertEquals(body.error, 'invalid_grant');
    assertEquals(body.error_description, 'Grant expired');
})
  Deno.test('oauth2Error - omits description when not provided', async () => {
  const { body } = await runWithContext((c) =>
      oauth2Error(c, 401, 'invalid_client')
    );
    assertEquals(body.error, 'invalid_client');
    assertEquals(body.error_description, undefined);
})