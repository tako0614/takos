// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN_GLOBAL = /[\u0000-\u001F\u007F]/g;
const CALLBACK_MESSAGE_MAX_LENGTH = 512;
const INVALID_CALLBACK_PAYLOAD_MESSAGE = 'Invalid callback payload';
const GENERIC_AUTH_FAILURE_MESSAGE = 'Authentication failed';

export interface CallbackParams {
  token: string | null;
  state: string | null;
  error: string | null;
}

export const OAUTH_CALLBACK_FAILURE_CODES = {
  CALLBACK_ERROR: 'callback_error',
  INVALID_STATE: 'invalid_state',
  MISSING_TOKEN: 'missing_token',
  SERVER_ERROR: 'server_error',
  UNEXPECTED_BIND_ADDRESS: 'unexpected_bind_address',
  TIMEOUT: 'timeout',
} as const;

export type OAuthCallbackFailureCode =
  (typeof OAUTH_CALLBACK_FAILURE_CODES)[keyof typeof OAUTH_CALLBACK_FAILURE_CODES];

interface ResolveCallbackParamsInput {
  method: string | undefined;
  contentType: string;
  body: string | null;
}

interface CallbackValidationFailure {
  ok: false;
  code: OAuthCallbackFailureCode;
  pageMessage: string;
  logMessage: string;
}

interface CallbackValidationSuccess {
  ok: true;
  token: string;
}

export type CallbackValidationResult = CallbackValidationFailure | CallbackValidationSuccess;

interface RawCallbackPayload {
  token?: unknown;
  state?: unknown;
  error?: unknown;
}

interface NormalizedCallbackField {
  value: string | null;
  valid: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeAuthMessage(message: string): string {
  const normalized = message.replace(CONTROL_CHAR_PATTERN_GLOBAL, '').trim();
  if (!normalized) {
    return GENERIC_AUTH_FAILURE_MESSAGE;
  }

  if (normalized.length <= CALLBACK_MESSAGE_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, CALLBACK_MESSAGE_MAX_LENGTH)}...`;
}

export function sanitizeAuthMessageForHtml(message: string): string {
  return escapeHtml(normalizeAuthMessage(message));
}

export function sanitizeAuthMessageForLog(message: string): string {
  const normalized = normalizeAuthMessage(message);
  return normalized.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function normalizeCallbackField(value: unknown): NormalizedCallbackField {
  if (value === undefined || value === null) {
    return { value: null, valid: true };
  }

  if (typeof value !== 'string') {
    return { value: null, valid: false };
  }

  if (value.length > 4096) {
    return { value: null, valid: false };
  }

  if (CONTROL_CHAR_PATTERN.test(value)) {
    return { value: null, valid: false };
  }

  return { value, valid: true };
}

function normalizeCallbackPayload(payload: RawCallbackPayload): CallbackParams | null {
  const token = normalizeCallbackField(payload.token);
  const state = normalizeCallbackField(payload.state);
  const error = normalizeCallbackField(payload.error);

  if (!token.valid || !state.valid || !error.valid) {
    return null;
  }

  return {
    token: token.value,
    state: state.value,
    error: error.value,
  };
}

function parseJsonCallbackPayload(body: string | null): RawCallbackPayload {
  if (!body) {
    throw new Error(INVALID_CALLBACK_PAYLOAD_MESSAGE);
  }
  const parsed = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(INVALID_CALLBACK_PAYLOAD_MESSAGE);
  }

  const payload = parsed as Record<string, unknown>;
  return {
    token: payload.token,
    state: payload.state,
    error: payload.error,
  };
}

function parseFormCallbackPayload(body: string | null): RawCallbackPayload {
  const params = new URLSearchParams(body ?? '');
  return {
    token: params.get('token'),
    state: params.get('state'),
    error: params.get('error'),
  };
}

export function resolveCallbackParams({
  method,
  contentType,
  body,
}: ResolveCallbackParamsInput): CallbackParams {
  if (method !== 'POST') {
    return {
      token: null,
      state: null,
      error: INVALID_CALLBACK_PAYLOAD_MESSAGE,
    };
  }

  try {
    const rawPayload = contentType.includes('application/json')
      ? parseJsonCallbackPayload(body)
      : parseFormCallbackPayload(body);

    const callbackParams = normalizeCallbackPayload(rawPayload);
    if (callbackParams !== null) {
      return callbackParams;
    }
  } catch {
    // Fail closed on malformed callback body.
  }

  return {
    token: null,
    state: null,
    error: INVALID_CALLBACK_PAYLOAD_MESSAGE,
  };
}

export function validateCallbackPayload(
  callbackParams: CallbackParams,
  oauthState: string,
): CallbackValidationResult {
  if (callbackParams.error === INVALID_CALLBACK_PAYLOAD_MESSAGE) {
    return {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.CALLBACK_ERROR,
      pageMessage: callbackParams.error,
      logMessage: callbackParams.error,
    };
  }

  if (callbackParams.state !== oauthState) {
    return {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.INVALID_STATE,
      pageMessage: 'Invalid state parameter - possible CSRF attack.',
      logMessage: 'Invalid state parameter (CSRF protection triggered)',
    };
  }

  if (callbackParams.error) {
    return {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.CALLBACK_ERROR,
      pageMessage: callbackParams.error,
      logMessage: callbackParams.error,
    };
  }

  if (!callbackParams.token) {
    return {
      ok: false,
      code: OAUTH_CALLBACK_FAILURE_CODES.MISSING_TOKEN,
      pageMessage: 'No token received',
      logMessage: 'No token received',
    };
  }

  return { ok: true, token: callbackParams.token };
}
