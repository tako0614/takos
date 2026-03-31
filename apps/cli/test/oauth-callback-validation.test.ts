import {
  escapeHtml,
  normalizeAuthMessage,
  sanitizeAuthMessageForHtml,
  sanitizeAuthMessageForLog,
  resolveCallbackParams,
  validateCallbackPayload,
  OAUTH_CALLBACK_FAILURE_CODES,
} from '../src/commands/oauth-callback-validation.ts';

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------


import { assertEquals } from 'jsr:@std/assert';

  Deno.test('escapeHtml - escapes ampersand', () => {
  assertEquals(escapeHtml('foo & bar'), 'foo &amp; bar');
})
  Deno.test('escapeHtml - escapes angle brackets', () => {
  assertEquals(escapeHtml('<script>alert(1)</script>'), 
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
})
  Deno.test('escapeHtml - escapes double and single quotes', () => {
  assertEquals(escapeHtml('"hello" & \'world\''), 
      '&quot;hello&quot; &amp; &#39;world&#39;',
    );
})
  Deno.test('escapeHtml - returns empty string unmodified', () => {
  assertEquals(escapeHtml(''), '');
})
  Deno.test('escapeHtml - does not alter plain text', () => {
  assertEquals(escapeHtml('hello world 123'), 'hello world 123');
})
  Deno.test('escapeHtml - handles all special chars in one string', () => {
  assertEquals(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
})
// ---------------------------------------------------------------------------
// normalizeAuthMessage
// ---------------------------------------------------------------------------


  Deno.test('normalizeAuthMessage - strips control characters', () => {
  assertEquals(normalizeAuthMessage('hello\u0000world'), 'helloworld');
})
  Deno.test('normalizeAuthMessage - trims whitespace', () => {
  assertEquals(normalizeAuthMessage('  hello  '), 'hello');
})
  Deno.test('normalizeAuthMessage - returns generic message for empty/whitespace-only input', () => {
  assertEquals(normalizeAuthMessage(''), 'Authentication failed');
    assertEquals(normalizeAuthMessage('   '), 'Authentication failed');
})
  Deno.test('normalizeAuthMessage - returns generic message for control-chars-only input', () => {
  assertEquals(normalizeAuthMessage('\u0000\u0001\u001F'), 'Authentication failed');
})
  Deno.test('normalizeAuthMessage - truncates messages longer than 512 chars', () => {
  const long = 'a'.repeat(600);
    const result = normalizeAuthMessage(long);
    assertEquals(result, 'a'.repeat(512) + '...');
    assertEquals(result.length, 515);
})
  Deno.test('normalizeAuthMessage - keeps messages at exactly 512 chars', () => {
  const exact = 'b'.repeat(512);
    assertEquals(normalizeAuthMessage(exact), exact);
})
  Deno.test('normalizeAuthMessage - handles mixed control chars and whitespace', () => {
  assertEquals(normalizeAuthMessage('\t\n some message \r\n'), 'some message');
})
// ---------------------------------------------------------------------------
// sanitizeAuthMessageForHtml
// ---------------------------------------------------------------------------


  Deno.test('sanitizeAuthMessageForHtml - combines normalization and HTML escaping', () => {
  assertEquals(sanitizeAuthMessageForHtml('<script>alert(1)</script>'), 
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
})
  Deno.test('sanitizeAuthMessageForHtml - handles control chars in input', () => {
  assertEquals(sanitizeAuthMessageForHtml('\u0000<b>bold</b>'), 
      '&lt;b&gt;bold&lt;/b&gt;',
    );
})
  Deno.test('sanitizeAuthMessageForHtml - returns escaped generic message for empty input', () => {
  assertEquals(sanitizeAuthMessageForHtml(''), 'Authentication failed');
})
// ---------------------------------------------------------------------------
// sanitizeAuthMessageForLog
// ---------------------------------------------------------------------------


  Deno.test('sanitizeAuthMessageForLog - escapes angle brackets in log output', () => {
  assertEquals(sanitizeAuthMessageForLog('<script>alert(1)</script>'), 
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
})
  Deno.test('sanitizeAuthMessageForLog - does not escape ampersand or quotes', () => {
  assertEquals(sanitizeAuthMessageForLog('foo & "bar"'), 'foo & "bar"');
})
  Deno.test('sanitizeAuthMessageForLog - returns generic message for empty input', () => {
  assertEquals(sanitizeAuthMessageForLog(''), 'Authentication failed');
})
// ---------------------------------------------------------------------------
// resolveCallbackParams - extended coverage
// ---------------------------------------------------------------------------


  Deno.test('resolveCallbackParams (extended) - handles POST JSON with error field', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ error: 'access_denied', state: 's1' }),
    });
    assertEquals(result, {
      token: null,
      state: 's1',
      error: 'access_denied',
    });
})
  Deno.test('resolveCallbackParams (extended) - handles POST form with all three fields', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: 'token=tk&state=st&error=err',
    });
    assertEquals(result, { token: 'tk', state: 'st', error: 'err' });
})
  Deno.test('resolveCallbackParams (extended) - handles POST form with empty body', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: null,
    });
    assertEquals(result, { token: null, state: null, error: null });
})
  Deno.test('resolveCallbackParams (extended) - fails closed for POST JSON with null body', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: null,
    });
    assertEquals(result.error, 'Invalid callback payload');
})
  Deno.test('resolveCallbackParams (extended) - fails closed for POST JSON with array body', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: '[]',
    });
    assertEquals(result.error, 'Invalid callback payload');
})
  Deno.test('resolveCallbackParams (extended) - fails closed for POST JSON with primitive body', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: '"a string"',
    });
    assertEquals(result.error, 'Invalid callback payload');
})
  Deno.test('resolveCallbackParams (extended) - rejects field values exceeding 4096 characters', () => {
  const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'ok',
        state: 'x'.repeat(4097),
      }),
    });
    assertEquals(result.error, 'Invalid callback payload');
})
  Deno.test('resolveCallbackParams (extended) - accepts field values at exactly 4096 characters', () => {
  const value = 'x'.repeat(4096);
    const result = resolveCallbackParams({
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ token: value, state: 'ok' }),
    });
    assertEquals(result.token, value);
    assertEquals(result.state, 'ok');
})
  Deno.test('resolveCallbackParams (extended) - fails closed for PUT method', () => {
  const result = resolveCallbackParams({
      method: 'PUT',
      contentType: 'application/json',
      body: JSON.stringify({ token: 'tk', state: 'st' }),
    });
    assertEquals(result.error, 'Invalid callback payload');
})
  Deno.test('resolveCallbackParams (extended) - fails closed for undefined method', () => {
  const result = resolveCallbackParams({
      method: undefined,
      contentType: '',
      body: null,
    });
    assertEquals(result.error, 'Invalid callback payload');
})
// ---------------------------------------------------------------------------
// validateCallbackPayload - extended coverage
// ---------------------------------------------------------------------------


  Deno.test('validateCallbackPayload (extended) - surfaces callback error when state matches', () => {
  const result = validateCallbackPayload(
      { token: null, state: 'expected', error: 'server_error' },
      'expected',
    );
    assertEquals(result, {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.CALLBACK_ERROR,
      pageMessage: 'server_error',
      logMessage: 'server_error',
    });
})
  Deno.test('validateCallbackPayload (extended) - returns MISSING_TOKEN when token is empty string', () => {
  const result = validateCallbackPayload(
      { token: '', state: 'expected', error: null },
      'expected',
    );
    assertEquals(result, {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.MISSING_TOKEN,
      pageMessage: 'No token received',
      logMessage: 'No token received',
    });
})
  Deno.test('validateCallbackPayload (extended) - returns success for valid payload with all fields', () => {
  const result = validateCallbackPayload(
      { token: 'valid-token', state: 'state-1', error: null },
      'state-1',
    );
    assertEquals(result, { ok: true, token: 'valid-token' });
})
  Deno.test('validateCallbackPayload (extended) - rejects null state against non-null expected state', () => {
  const result = validateCallbackPayload(
      { token: 'tk', state: null, error: null },
      'expected-state',
    );
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.code, OAUTH_CALLBACK_FAILURE_CODES.INVALID_STATE);
    }
})