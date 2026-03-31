import { cyan, gray, red } from '@std/fmt/colors';
import { cliExit } from '../lib/command-exit.ts';
import {
  createAuthorizedRequest,
  parseSseEventBlock,
  toWebSocketUrl,
  tryParseJson,
} from './api-request.ts';
import type { ParsedSseEvent, StreamCommandOptions } from './api-request.ts';
import { Buffer } from "node:buffer";

function printSseEvent(event: ParsedSseEvent, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify({
      type: 'sse',
      event: event.event,
      id: event.id ?? null,
      retry: event.retry ?? null,
      data: event.data === null ? null : tryParseJson(event.data),
    }));
    return;
  }

  const headerParts = [`[${event.event}]`];
  if (event.id) {
    headerParts.push(`id=${event.id}`);
  }
  if (event.retry !== undefined) {
    headerParts.push(`retry=${event.retry}`);
  }

  const header = cyan(headerParts.join(' '));
  if (event.data === null) {
    console.log(header);
    return;
  }

  const parsed = tryParseJson(event.data);
  if (typeof parsed === 'string') {
    console.log(`${header} ${parsed}`);
    return;
  }

  console.log(`${header} ${JSON.stringify(parsed)}`);
}

function setupInterruptHandler(controller: AbortController): {
  isInterrupted: () => boolean;
  cleanup: () => void;
} {
  let interrupted = false;

  const onSigint = (): void => {
    interrupted = true;
    controller.abort();
  };

  Deno.addSignalListener('SIGINT', onSigint);

  return {
    isInterrupted: () => interrupted,
    cleanup: () => Deno.removeSignalListener('SIGINT', onSigint),
  };
}

async function readSseEvents(
  body: ReadableStream<Uint8Array>,
  jsonOutput: boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');

    while (boundary !== -1) {
      const rawBlock = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const event = parseSseEventBlock(rawBlock);
      if (event) {
        printSseEvent(event, jsonOutput);
      }

      boundary = buffer.indexOf('\n\n');
    }
  }

  const remaining = buffer.trim();
  if (remaining) {
    const event = parseSseEventBlock(remaining);
    if (event) {
      printSseEvent(event, jsonOutput);
    }
  }
}

export async function executeSseStream(path: string, options: StreamCommandOptions): Promise<void> {
  const { url, headers } = createAuthorizedRequest(path, options);
  headers.Accept = 'text/event-stream';
  headers['Cache-Control'] = 'no-cache';

  if (options.lastEventId) {
    headers['Last-Event-ID'] = options.lastEventId;
  }

  const controller = new AbortController();
  const { isInterrupted, cleanup } = setupInterruptHandler(controller);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch((e) => { console.warn('Failed to read SSE error response body:', e); return ''; });
      console.log(red(body || `HTTP ${response.status} ${response.statusText}`));
      cliExit(1);
    }

    if (!response.body) {
      console.log(red('SSE stream body is not available'));
      cliExit(1);
    }

    await readSseEvents(response.body, !!options.json);

    if (!isInterrupted()) {
      console.log(gray('SSE stream closed'));
    }
  } catch (error) {
    if (isInterrupted() && error instanceof Error && error.name === 'AbortError') {
      console.log(gray('SSE stream stopped'));
      return;
    }

    console.log(red(`SSE stream error: ${String(error)}`));
    cliExit(1);
  } finally {
    cleanup();
  }
}

function toTextPayload(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof Buffer) {
    return data.toString('utf8');
  }

  if (Array.isArray(data)) {
    return Buffer.concat(data.map((item) => Buffer.isBuffer(item) ? item : Buffer.from(String(item)))).toString('utf8');
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }

  return String(data);
}

function printWebSocketMessage(payload: string, jsonOutput: boolean): void {
  if (jsonOutput) {
    console.log(JSON.stringify({
      type: 'ws',
      data: tryParseJson(payload),
    }));
    return;
  }

  const parsed = tryParseJson(payload);
  if (typeof parsed === 'string') {
    console.log(parsed);
    return;
  }

  console.log(JSON.stringify(parsed));
}

export async function executeWebSocketStream(path: string, options: StreamCommandOptions): Promise<void> {
  const { url, headers } = createAuthorizedRequest(path, options);
  const wsUrl = toWebSocketUrl(url);

  const wsModule = await import('ws');
  const WebSocketCtor = wsModule.default as unknown as new (
    address: string,
    options: { headers: Record<string, string> }
  ) => {
    on: (event: string, handler: (...args: unknown[]) => void) => void;
    send: (data: string) => void;
    close: (code?: number, data?: string) => void;
  };

  let interrupted = false;
  let closeCode = 1000;
  let closeReason = '';

  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocketCtor(wsUrl.toString(), { headers });

    const onSigint = (): void => {
      interrupted = true;
      socket.close(1000, 'SIGINT');
    };
    Deno.addSignalListener('SIGINT', onSigint);

    socket.on('open', () => {
      console.log(gray(`WebSocket connected: ${wsUrl}`));
      for (const message of options.send ?? []) {
        socket.send(message);
      }
    });

    socket.on('message', (data: unknown) => {
      const payload = toTextPayload(data);
      printWebSocketMessage(payload, !!options.json);
    });

    socket.on('error', (error: unknown) => {
      Deno.removeSignalListener('SIGINT', onSigint);
      reject(error);
    });

    socket.on('close', (code: unknown, reason: unknown) => {
      closeCode = typeof code === 'number' ? code : 0;
      closeReason = toTextPayload(reason as Buffer);
      Deno.removeSignalListener('SIGINT', onSigint);
      resolve();
    });
  }).catch((error: unknown) => {
    console.log(red(`WebSocket stream error: ${String(error)}`));
    cliExit(1);
  });

  if (interrupted) {
    console.log(gray('WebSocket stream stopped'));
    return;
  }

  if (closeCode !== 1000) {
    const detail = closeReason ? ` (${closeReason})` : '';
    console.log(red(`WebSocket closed with code ${closeCode}${detail}`));
    cliExit(1);
  }

  console.log(gray('WebSocket stream closed'));
}
