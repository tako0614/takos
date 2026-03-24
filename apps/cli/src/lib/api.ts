/**
 * API client for takos platform
 */

import { getApiRequestTimeoutMs, getConfig } from './config.js';

interface ApiError {
  error: string;
  details?: string;
}

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

class ApiTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms`);
    this.name = 'ApiTimeoutError';
  }
}

export function createAuthHeaders(options: {
  headers?: Record<string, string>;
  spaceId?: string;
} = {}): Record<string, string> {
  const config = getConfig();
  const headers: Record<string, string> = {
    ...(options.headers ?? {}),
  };

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  if (config.sessionId) {
    headers['X-Takos-Session-Id'] = config.sessionId;
  }

  const spaceId = options.spaceId ?? config.spaceId;
  if (spaceId) {
    headers['X-Takos-Space-Id'] = spaceId;
  }

  return headers;
}

async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = getApiRequestTimeoutMs()
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Sanitize error messages to prevent information disclosure.
 * Removes system paths, stack traces, and other sensitive information.
 */
function sanitizeErrorMessage(error: unknown): string {
  const DEFAULT_ERROR = 'An unexpected error occurred';

  let message: string;
  if (error instanceof Error) {
    message = error.message
      .replace(/at\s+[^\s]+\s+\([^)]+\)/g, '')
      .replace(/\n\s*at\s+.*/g, '')
      .replace(/Error:\s*/g, '');
  } else if (typeof error === 'string') {
    message = error;
  } else {
    return DEFAULT_ERROR;
  }

  let sanitized = message
    .replace(/[A-Za-z]:\\[^\s:]+/g, '[path]')
    .replace(/\/(?:home|Users|var|tmp|etc|usr)[^\s:]+/g, '[path]');

  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200) + '...';
  }

  return sanitized.trim() || DEFAULT_ERROR;
}

// Make API request
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: FormData | Record<string, unknown>;
    headers?: Record<string, string>;
    timeout?: number;  // Optional timeout in milliseconds (default: configured API timeout)
  } = {}
): Promise<ApiResponse<T>> {
  const config = getConfig();

  if (!config.token && !config.sessionId) {
    return { ok: false, error: 'Not authenticated. Run `takos login` first.' };
  }

  const url = `${config.apiUrl}${path}`;
  const headers = createAuthHeaders({ headers: options.headers });

  let body: FormData | string | undefined;

  if (options.body instanceof FormData) {
    body = options.body;
  } else if (options.body) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const timeoutMs = options.timeout ?? getApiRequestTimeoutMs();

  try {
    const response = await fetchWithTimeout(url, {
      method: options.method || 'GET',
      headers,
      body,
    }, timeoutMs);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: response.statusText })) as ApiError;
      return { ok: false, error: errorData.error || `HTTP ${response.status}` };
    }

    // 204/205 and empty 2xx bodies are valid for endpoints that return no content.
    if (response.status === 204 || response.status === 205) {
      return { ok: true, data: undefined as T };
    }

    const responseText = await response.text();
    if (responseText.trim() === '') {
      return { ok: true, data: undefined as T };
    }

    let data: T;
    try {
      data = JSON.parse(responseText) as T;
    } catch {
      return { ok: false, error: 'Invalid response from server' };
    }
    if (data === null || data === undefined) {
      return { ok: false, error: 'Invalid response from server' };
    }

    return { ok: true, data };
  } catch (err) {
    // Handle timeout specifically
    if (err instanceof ApiTimeoutError) {
      return { ok: false, error: 'Request timed out' };
    }

    // Sanitize error message to prevent information disclosure
    return { ok: false, error: `Network error: ${sanitizeErrorMessage(err)}` };
  }
}
