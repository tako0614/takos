import {
  OAUTH_CALLBACK_FAILURE_CODES,
  resolveCallbackParams,
  validateCallbackPayload,
} from '../src/commands/oauth-callback-validation.ts';


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('resolveCallbackParams - parses POST json body as canonical callback data', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        token: 'token-from-body',
        state: 'state-from-body',
      }),
    });

    assertEquals(result, {
      token: 'token-from-body',
      state: 'state-from-body',
      error: null,
    });
})
  Deno.test('resolveCallbackParams - parses POST form payload as canonical callback data', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: 'token=token-from-form&state=state-from-form',
    });

    assertEquals(result, {
      token: 'token-from-form',
      state: 'state-from-form',
      error: null,
    });
})
  Deno.test('resolveCallbackParams - fails closed for GET callback payload', () => {
  const result = resolveCallbackParams({
      method: 'GET',
      contentType: '',
      body: null,
    });

    assertEquals(result, {
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
})
  Deno.test('resolveCallbackParams - fails closed for malformed POST json payload', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: '{"token":"token",',
    });

    assertEquals(result, {
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
})
  Deno.test('resolveCallbackParams - fails closed when callback payload fields are not strings', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 123,
        state: 'state-from-body',
      }),
    });

    assertEquals(result, {
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
})
  Deno.test('resolveCallbackParams - fails closed when callback payload contains control characters', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'token-from-body',
        state: 'state-from-body\u0000',
      }),
    });

    assertEquals(result, {
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
})
  Deno.test('resolveCallbackParams - fails closed when callback payload field is too long', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 't'.repeat(4097),
        state: 'state-from-body',
      }),
    });

    assertEquals(result, {
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
})

  Deno.test('validateCallbackPayload - returns payload error before state/token validation', () => {
  const result = validateCallbackPayload(
      { token: null, state: null, error: 'Invalid callback payload' },
      'expected-state',
    );

    assertEquals(result, {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.CALLBACK_ERROR,
      pageMessage: 'Invalid callback payload',
      logMessage: 'Invalid callback payload',
    });
})
  Deno.test('validateCallbackPayload - prioritizes invalid state over callback error injection', () => {
  const result = validateCallbackPayload(
      {
        token: 'token',
        state: 'wrong-state',
        error: 'Injected callback error',
      },
      'expected-state',
    );

    assertEquals(result, {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.INVALID_STATE,
      pageMessage: 'Invalid state parameter - possible CSRF attack.',
      logMessage: 'Invalid state parameter (CSRF protection triggered)',
    });
})
  Deno.test('validateCallbackPayload - fails closed for invalid state', () => {
  const result = validateCallbackPayload(
      {
        token: 'token',
        state: 'wrong-state',
        error: null,
      },
      'expected-state',
    );

    assertEquals(result, {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.INVALID_STATE,
      pageMessage: 'Invalid state parameter - possible CSRF attack.',
      logMessage: 'Invalid state parameter (CSRF protection triggered)',
    });
})
  Deno.test('validateCallbackPayload - fails closed when token is missing', () => {
  const result = validateCallbackPayload(
      {
        token: null,
        state: 'expected-state',
        error: null,
      },
      'expected-state',
    );

    assertEquals(result, {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.MISSING_TOKEN,
      pageMessage: 'No token received',
      logMessage: 'No token received',
    });
})
  Deno.test('validateCallbackPayload - accepts valid callback payload', () => {
  const result = validateCallbackPayload(
      {
        token: 'token',
        state: 'expected-state',
        error: null,
      },
      'expected-state',
    );

    assertEquals(result, {
      ok: true,
      token: 'token',
    });
})