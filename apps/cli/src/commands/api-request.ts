import { basename } from 'path';
import chalk from 'chalk';
import { readFileSync, writeFileSync } from 'fs';
import { cliExit } from '../lib/command-exit.js';
import { getApiRequestTimeoutMs, getConfig } from '../lib/config.js';
import { createAuthHeaders } from '../lib/api.js';

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

export interface ParsedSseEvent {
  event: string;
  id?: string;
  retry?: number;
  data: string | null;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

function isKnownHttpMethod(value: string): value is HttpMethod {
  return HTTP_METHODS.includes(value.toUpperCase() as HttpMethod);
}

export function parseKeyValue(value: string): { key: string; value: string } {
  const separatorIndex = value.indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error(`Invalid key=value option: ${value}`);
  }

  const key = value.slice(0, separatorIndex).trim();
  const parsedValue = value.slice(separatorIndex + 1);
  if (!key) {
    throw new Error(`Invalid key=value option: ${value}`);
  }

  return { key, value: parsedValue };
}

export type BodyPreparation = {
  body: unknown;
  contentType: string | null;
};

type BodyOptions = {
  body?: string;
  bodyFile?: string;
  rawBody?: string;
  rawBodyFile?: string;
  form?: string[];
  formFile?: string[];
  contentType?: string;
};

function prepareJsonBody(options: BodyOptions): BodyPreparation {
  const raw = options.body !== undefined ? options.body : readFileSync(options.bodyFile!, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return {
      body: JSON.stringify(parsed),
      contentType: 'application/json',
    };
  } catch (error) {
    throw new Error(`Invalid JSON body: ${String(error)}`);
  }
}

function prepareRawBody(options: BodyOptions): BodyPreparation {
  if (options.rawBody !== undefined) {
    return {
      body: options.rawBody,
      contentType: options.contentType ?? 'text/plain; charset=utf-8',
    };
  }

  const buffer = readFileSync(options.rawBodyFile!);
  return {
    body: buffer,
    contentType: options.contentType ?? 'application/octet-stream',
  };
}

function prepareFormBody(options: BodyOptions): BodyPreparation {
  const formData = new FormData();

  for (const pair of options.form ?? []) {
    const { key, value } = parseKeyValue(pair);
    formData.append(key, value);
  }

  for (const pair of options.formFile ?? []) {
    const { key, value } = parseKeyValue(pair);
    const fileContent = readFileSync(value);
    formData.append(key, new Blob([fileContent]), basename(value));
  }

  return {
    body: formData,
    contentType: null,
  };
}

export function prepareBody(options: BodyOptions): BodyPreparation {
  const hasJsonInline = options.body !== undefined;
  const hasJsonFile = options.bodyFile !== undefined;
  const hasRawInline = options.rawBody !== undefined;
  const hasRawFile = options.rawBodyFile !== undefined;
  const hasForm = (options.form?.length ?? 0) > 0 || (options.formFile?.length ?? 0) > 0;

  const jsonMode = hasJsonInline || hasJsonFile;
  const rawMode = hasRawInline || hasRawFile;

  const activeModes = [jsonMode, rawMode, hasForm].filter(Boolean).length;
  if (activeModes > 1) {
    throw new Error('Only one body mode can be used at a time (json, raw, or form)');
  }

  if (jsonMode) {
    return prepareJsonBody(options);
  }

  if (rawMode) {
    return prepareRawBody(options);
  }

  if (hasForm) {
    return prepareFormBody(options);
  }

  return {
    body: undefined,
    contentType: null,
  };
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

export function parseSseEventBlock(block: string): ParsedSseEvent | null {
  if (!block.trim()) {
    return null;
  }

  const event: ParsedSseEvent = {
    event: 'message',
    data: null,
  };

  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) {
      continue;
    }

    const field = line.slice(0, separator);
    const value = line.slice(separator + 1).trimStart();

    if (field === 'event') {
      event.event = value || 'message';
      continue;
    }

    if (field === 'id') {
      event.id = value;
      continue;
    }

    if (field === 'retry') {
      const retryMs = Number(value);
      if (Number.isInteger(retryMs) && retryMs >= 0) {
        event.retry = retryMs;
      }
      continue;
    }

    if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length > 0) {
    event.data = dataLines.join('\n');
  }

  return event;
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

export function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseBodyByContentType(contentType: string | null, bodyBuffer: Buffer): unknown {
  if (bodyBuffer.length === 0) {
    return null;
  }

  if (contentType?.includes('application/json')) {
    try {
      return JSON.parse(bodyBuffer.toString('utf8'));
    } catch {
      return bodyBuffer.toString('utf8');
    }
  }

  if (contentType?.startsWith('text/') || contentType?.includes('application/xml')) {
    return bodyBuffer.toString('utf8');
  }

  return {
    encoding: 'base64',
    size: bodyBuffer.length,
    data: bodyBuffer.toString('base64'),
  };
}

function printSuccess(parsedBody: unknown, jsonOutput: boolean): void {
  if (parsedBody === null || parsedBody === undefined) {
    console.log(chalk.green('OK'));
    return;
  }

  if (typeof parsedBody === 'string') {
    console.log(parsedBody);
    return;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(parsedBody));
    return;
  }

  console.log(JSON.stringify(parsedBody, null, 2));
}

export async function executeApiRequest(methodInput: string, path: string, options: ApiCommandOptions): Promise<void> {
  const method = methodInput.toUpperCase();
  if (!isKnownHttpMethod(method)) {
    console.log(chalk.red(`Unsupported method: ${methodInput}`));
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
      console.log(chalk.red(`Request timed out after ${timeoutMs}ms`));
      cliExit(1);
    }

    console.log(chalk.red(`Network error: ${String(error)}`));
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
      console.log(chalk.green(`Saved response to ${options.output} (${bodyBuffer.length} bytes)`));
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
      console.log(chalk.red(parsedBody));
    } else if (parsedBody && typeof parsedBody === 'object' && 'error' in parsedBody) {
      const errorMessage = String((parsedBody as Record<string, unknown>).error);
      console.log(chalk.red(errorMessage));
    } else {
      console.log(chalk.red(`HTTP ${response.status} ${response.statusText}`));
    }
    cliExit(1);
  }

  printSuccess(parsedBody, !!options.json);
}
