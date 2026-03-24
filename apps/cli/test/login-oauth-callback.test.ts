import { describe, expect, it } from 'vitest';
import {
  OAUTH_CALLBACK_FAILURE_CODES,
  resolveCallbackParams,
  validateCallbackPayload,
} from '../src/commands/oauth-callback-validation.js';

describe('resolveCallbackParams', () => {
  it('parses POST json body as canonical callback data', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        token: 'token-from-body',
        state: 'state-from-body',
      }),
    });

    expect(result).toEqual({
      token: 'token-from-body',
      state: 'state-from-body',
      error: null,
    });
  });

  it('parses POST form payload as canonical callback data', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: 'token=token-from-form&state=state-from-form',
    });

    expect(result).toEqual({
      token: 'token-from-form',
      state: 'state-from-form',
      error: null,
    });
  });

  it('fails closed for GET callback payload', () => {
    const result = resolveCallbackParams({
      method: 'GET',
      contentType: '',
      body: null,
    });

    expect(result).toEqual({
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
  });

  it('fails closed for malformed POST json payload', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: '{"token":"token",',
    });

    expect(result).toEqual({
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
  });

  it('fails closed when callback payload fields are not strings', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 123,
        state: 'state-from-body',
      }),
    });

    expect(result).toEqual({
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
  });

  it('fails closed when callback payload contains control characters', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'token-from-body',
        state: 'state-from-body\u0000',
      }),
    });

    expect(result).toEqual({
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
  });

  it('fails closed when callback payload field is too long', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 't'.repeat(4097),
        state: 'state-from-body',
      }),
    });

    expect(result).toEqual({
      token: null,
      state: null,
      error: 'Invalid callback payload',
    });
  });
});

describe('validateCallbackPayload', () => {
  it('returns payload error before state/token validation', () => {
    const result = validateCallbackPayload(
      { token: null, state: null, error: 'Invalid callback payload' },
      'expected-state',
    );

    expect(result).toEqual({
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.CALLBACK_ERROR,
      pageMessage: 'Invalid callback payload',
      logMessage: 'Invalid callback payload',
    });
  });

  it('prioritizes invalid state over callback error injection', () => {
    const result = validateCallbackPayload(
      {
        token: 'token',
        state: 'wrong-state',
        error: 'Injected callback error',
      },
      'expected-state',
    );

    expect(result).toEqual({
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.INVALID_STATE,
      pageMessage: 'Invalid state parameter - possible CSRF attack.',
      logMessage: 'Invalid state parameter (CSRF protection triggered)',
    });
  });

  it('fails closed for invalid state', () => {
    const result = validateCallbackPayload(
      {
        token: 'token',
        state: 'wrong-state',
        error: null,
      },
      'expected-state',
    );

    expect(result).toEqual({
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.INVALID_STATE,
      pageMessage: 'Invalid state parameter - possible CSRF attack.',
      logMessage: 'Invalid state parameter (CSRF protection triggered)',
    });
  });

  it('fails closed when token is missing', () => {
    const result = validateCallbackPayload(
      {
        token: null,
        state: 'expected-state',
        error: null,
      },
      'expected-state',
    );

    expect(result).toEqual({
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.MISSING_TOKEN,
      pageMessage: 'No token received',
      logMessage: 'No token received',
    });
  });

  it('accepts valid callback payload', () => {
    const result = validateCallbackPayload(
      {
        token: 'token',
        state: 'expected-state',
        error: null,
      },
      'expected-state',
    );

    expect(result).toEqual({
      ok: true,
      token: 'token',
    });
  });
});
