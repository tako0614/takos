import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  normalizeAuthMessage,
  sanitizeAuthMessageForHtml,
  sanitizeAuthMessageForLog,
  resolveCallbackParams,
  validateCallbackPayload,
  OAUTH_CALLBACK_FAILURE_CODES,
} from '../src/commands/oauth-callback-validation.js';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
  });

  it('escapes angle brackets', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('escapes double and single quotes', () => {
    expect(escapeHtml('"hello" & \'world\'')).toBe(
      '&quot;hello&quot; &amp; &#39;world&#39;',
    );
  });

  it('returns empty string unmodified', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('does not alter plain text', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });

  it('handles all special chars in one string', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

// ---------------------------------------------------------------------------
// normalizeAuthMessage
// ---------------------------------------------------------------------------

describe('normalizeAuthMessage', () => {
  it('strips control characters', () => {
    expect(normalizeAuthMessage('hello\u0000world')).toBe('helloworld');
  });

  it('trims whitespace', () => {
    expect(normalizeAuthMessage('  hello  ')).toBe('hello');
  });

  it('returns generic message for empty/whitespace-only input', () => {
    expect(normalizeAuthMessage('')).toBe('Authentication failed');
    expect(normalizeAuthMessage('   ')).toBe('Authentication failed');
  });

  it('returns generic message for control-chars-only input', () => {
    expect(normalizeAuthMessage('\u0000\u0001\u001F')).toBe('Authentication failed');
  });

  it('truncates messages longer than 512 chars', () => {
    const long = 'a'.repeat(600);
    const result = normalizeAuthMessage(long);
    expect(result).toBe('a'.repeat(512) + '...');
    expect(result.length).toBe(515);
  });

  it('keeps messages at exactly 512 chars', () => {
    const exact = 'b'.repeat(512);
    expect(normalizeAuthMessage(exact)).toBe(exact);
  });

  it('handles mixed control chars and whitespace', () => {
    expect(normalizeAuthMessage('\t\n some message \r\n')).toBe('some message');
  });
});

// ---------------------------------------------------------------------------
// sanitizeAuthMessageForHtml
// ---------------------------------------------------------------------------

describe('sanitizeAuthMessageForHtml', () => {
  it('combines normalization and HTML escaping', () => {
    expect(sanitizeAuthMessageForHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('handles control chars in input', () => {
    expect(sanitizeAuthMessageForHtml('\u0000<b>bold</b>')).toBe(
      '&lt;b&gt;bold&lt;/b&gt;',
    );
  });

  it('returns escaped generic message for empty input', () => {
    expect(sanitizeAuthMessageForHtml('')).toBe('Authentication failed');
  });
});

// ---------------------------------------------------------------------------
// sanitizeAuthMessageForLog
// ---------------------------------------------------------------------------

describe('sanitizeAuthMessageForLog', () => {
  it('escapes angle brackets in log output', () => {
    expect(sanitizeAuthMessageForLog('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('does not escape ampersand or quotes', () => {
    expect(sanitizeAuthMessageForLog('foo & "bar"')).toBe('foo & "bar"');
  });

  it('returns generic message for empty input', () => {
    expect(sanitizeAuthMessageForLog('')).toBe('Authentication failed');
  });
});

// ---------------------------------------------------------------------------
// resolveCallbackParams - extended coverage
// ---------------------------------------------------------------------------

describe('resolveCallbackParams (extended)', () => {
  it('handles POST JSON with error field', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ error: 'access_denied', state: 's1' }),
    });
    expect(result).toEqual({
      token: null,
      state: 's1',
      error: 'access_denied',
    });
  });

  it('handles POST form with all three fields', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: 'token=tk&state=st&error=err',
    });
    expect(result).toEqual({ token: 'tk', state: 'st', error: 'err' });
  });

  it('handles POST form with empty body', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: null,
    });
    expect(result).toEqual({ token: null, state: null, error: null });
  });

  it('fails closed for POST JSON with null body', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: null,
    });
    expect(result.error).toBe('Invalid callback payload');
  });

  it('fails closed for POST JSON with array body', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: '[]',
    });
    expect(result.error).toBe('Invalid callback payload');
  });

  it('fails closed for POST JSON with primitive body', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: '"a string"',
    });
    expect(result.error).toBe('Invalid callback payload');
  });

  it('rejects field values exceeding 4096 characters', () => {
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'ok',
        state: 'x'.repeat(4097),
      }),
    });
    expect(result.error).toBe('Invalid callback payload');
  });

  it('accepts field values at exactly 4096 characters', () => {
    const value = 'x'.repeat(4096);
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ token: value, state: 'ok' }),
    });
    expect(result.token).toBe(value);
    expect(result.state).toBe('ok');
  });

  it('fails closed for PUT method', () => {
    const result = resolveCallbackParams({
      method: 'PUT',
      contentType: 'application/json',
      body: JSON.stringify({ token: 'tk', state: 'st' }),
    });
    expect(result.error).toBe('Invalid callback payload');
  });

  it('fails closed for undefined method', () => {
    const result = resolveCallbackParams({
      method: undefined,
      contentType: '',
      body: null,
    });
    expect(result.error).toBe('Invalid callback payload');
  });
});

// ---------------------------------------------------------------------------
// validateCallbackPayload - extended coverage
// ---------------------------------------------------------------------------

describe('validateCallbackPayload (extended)', () => {
  it('surfaces callback error when state matches', () => {
    const result = validateCallbackPayload(
      { token: null, state: 'expected', error: 'server_error' },
      'expected',
    );
    expect(result).toEqual({
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.CALLBACK_ERROR,
      pageMessage: 'server_error',
      logMessage: 'server_error',
    });
  });

  it('returns MISSING_TOKEN when token is empty string', () => {
    const result = validateCallbackPayload(
      { token: '', state: 'expected', error: null },
      'expected',
    );
    expect(result).toEqual({
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.MISSING_TOKEN,
      pageMessage: 'No token received',
      logMessage: 'No token received',
    });
  });

  it('returns success for valid payload with all fields', () => {
    const result = validateCallbackPayload(
      { token: 'valid-token', state: 'state-1', error: null },
      'state-1',
    );
    expect(result).toEqual({ ok: true, token: 'valid-token' });
  });

  it('rejects null state against non-null expected state', () => {
    const result = validateCallbackPayload(
      { token: 'tk', state: null, error: null },
      'expected-state',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(OAUTH_CALLBACK_FAILURE_CODES.INVALID_STATE);
    }
  });
});
