import { green, red } from '@std/fmt/colors';
import { writeFileSync } from 'node:fs';
import { cliExit } from '../lib/command-exit.ts';
import { getApiRequestTimeoutMs, getConfig } from '../lib/config.ts';
import { createAuthHeaders } from '../lib/api.ts';
import { parseKeyValue } from './api-request-body.ts';
import { prepareBody } from './api-request-body.ts';
import { parseBodyByContentType, printSuccess } from './api-request-output.ts';
import { Buffer } from "node:buffer";

// Re-export everything from sub-modules for backward compatibility
export { parseKeyValue, prepareBody } from './api-request-body.ts';
export type { BodyPreparation } from './api-request-body.ts';
export { parseSseEventBlock } from './api-request-sse.ts';
export type { ParsedSseEvent } from './api-request-sse.ts';
export { tryParseJson } from './api-request-output.ts';

export type ApiCommandOptions = {
  query?: string[];
  header?: string[];
  body?: string;
  bodyFile?: string;
  rawBody?: string;
  rawBodyFile?: string;
  form?: string[];
  formFile?: string[];
  contentType?: string;
  output?: string;
  json?: boolean;
  workspace?: string;
};

export type RequestScopeOptions = {
  query?: string[];
  header?: string[];
  workspace?: string;
};

export type StreamCommandOptions = RequestScopeOptions & {
  json?: boolean;
  lastEventId?: string;
  send?: string[];
};

export type WatchTaskOptions = StreamCommandOptions & {
  transport?: string;
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isKnownHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHODS.includes(value.toUpperCase() as HttpMethod);
}

function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('API path is required');
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  if (!(normalized === '/api' || normalized.startsWith('/api/'))) {
    throw new Error(`Path must start with /api: ${normalized}`);
  }

  return normalized;
}

export function resolveTaskPath(basePath: string, suffix: string | undefined): string {
  if (!suffix || suffix.trim() === '' || suffix.trim() === '/') {
    return normalizeApiPath(basePath);
  }

  const trimmedSuffix = suffix.trim();
  if (basePath === '/api') {
    if (trimmedSuffix.startsWith('/api')) {
      return normalizeApiPath(trimmedSuffix);
    }

    const normalizedRelativeSuffix = trimmedSuffix.startsWith('/') ? trimmedSuffix : `/${trimmedSuffix}`;
    return normalizeApiPath(`/api${normalizedRelativeSuffix}`);
  }

  const normalizedSuffix = trimmedSuffix.startsWith('/') ? trimmedSuffix : `/${trimmedSuffix}`;
  return normalizeApiPath(`${basePath}${normalizedSuffix}`);
}

export function toWebSocketUrl(url: URL): URL {
  const wsUrl = new URL(url.toString());
  if (wsUrl.protocol === 'https:') {
    wsUrl.protocol = 'wss:';
    return wsUrl;
  }
  if (wsUrl.protocol === 'http:') {
    wsUrl.protocol = 'ws:';
    return wsUrl;
  }

  throw new Error(`Unsupported protocol for WebSocket conversion: ${wsUrl.protocol}`);
}

export function buildRunWatchPath(runId: string, transport: 'ws' | 'sse'): string {
  const encodedRunId = encodeURIComponent(runId);
  return transport === 'sse'
    ? `/api/runs/${encodedRunId}/events`
    : `/api/runs/${encodedRunId}/ws`;
}

export function buildActionsWatchPath(repoId: string, runId: string): string {
  const encodedRepoId = encodeURIComponent(repoId);
  const encodedRunId = encodeURIComponent(runId);
  return `/api/repos/${encodedRepoId}/actions/runs/${encodedRunId}/ws`;
}

function prepareHeaders(options: { header?: string[] }): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const pair of options.header ?? []) {
    const { key, value } = parseKeyValue(pair);
    headers[key] = value;
  }

  return headers;
}

function buildUrl(path: string, queryOptions: string[] | undefined, apiUrl: string): URL {
  const url = new URL(path, apiUrl);

  for (const pair of queryOptions ?? []) {
    const { key, value } = parseKeyValue(pair);
    url.searchParams.append(key, value);
  }

  return url;
}

export function createAuthorizedRequest(path: string, options: RequestScopeOptions): { url: URL; headers: Record<string, string> } {
  // Auth is enforced by the preAction hook in index.ts; no duplicate check needed here.
  const config = getConfig();
  const url = buildUrl(path, options.query, config.apiUrl);
  const customHeaders = prepareHeaders(options);
  const headers = createAuthHeaders({ headers: customHeaders, spaceId: options.workspace });

  return { url, headers };
}

export async function executeApiRequest(methodInput: string, path: string, options: ApiCommandOptions): Promise<void> {
  const method = methodInput.toUpperCase();
  if (!isKnownHttpMethod(method)) {
    console.log(red(`Unsupported method: ${methodInput}`));
    cliExit(1);
  }

  const { url, headers } = createAuthorizedRequest(path, options);

  const { body, contentType } = prepareBody(options);
  if (contentType && !headers['Content-Type']) {
    headers['Content-Type'] = contentType;
  }

  const timeoutMs = getApiRequestTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body as RequestInit['body'],
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(red(`Request timed out after ${timeoutMs}ms`));
      cliExit(1);
    }

    console.log(red(`Network error: ${String(error)}`));
    cliExit(1);
  }

  clearTimeout(timeout);

  const bodyBuffer = Buffer.from(await response.arrayBuffer());
  const contentTypeHeader = response.headers.get('content-type');

  if (options.output) {
    writeFileSync(options.output, bodyBuffer);

    const report = {
      ok: response.ok,
      status: response.status,
      path: options.output,
      bytes: bodyBuffer.length,
      content_type: contentTypeHeader,
    };

    if (options.json) {
      console.log(JSON.stringify(report));
    } else {
      console.log(green(`Saved response to ${options.output} (${bodyBuffer.length} bytes)`));
    }

    if (!response.ok) {
      cliExit(1);
    }

    return;
  }

  const parsedBody = parseBodyByContentType(contentTypeHeader, bodyBuffer);

  if (options.json) {
    const output = {
      ok: response.ok,
      status: response.status,
      status_text: response.statusText,
      content_type: contentTypeHeader,
      data: parsedBody,
    };
    console.log(JSON.stringify(output));

    if (!response.ok) {
      cliExit(1);
    }
    return;
  }

  if (!response.ok) {
    if (typeof parsedBody === 'string') {
      console.log(red(parsedBody));
    } else if (parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody) {
      const errorMessage = String((parsedBody as Record<string, unknown>).error);
      console.log(red(errorMessage));
    } else {
      console.log(red(`HTTP ${response.status} ${response.statusText}`));
    }
    cliExit(1);
  }

  printSuccess(parsedBody, !!options.json);
}
