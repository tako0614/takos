import { parentPort } from 'worker_threads';
import vm from 'vm';
import { TOOL_NAME_PATTERN, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../../shared/config.ts';
import { getErrorMessage } from 'takos-common/errors';
import { createLogger } from 'takos-common/logger';
import {
  normalizeAllowedDomains,
  parseFetchUrl,
  assertOutboundUrlAllowed,
  ALLOWED_PROTOCOLS,
} from './network.ts';

const logger = createLogger({ service: 'takos-runtime' });

/**
 * Tool Worker — executes user-defined tool code in a Node.js vm context.
 *
 * TRUST MODEL: This worker uses Node.js `vm` module which is NOT a security
 * sandbox. It prevents accidental global pollution but does not isolate
 * against malicious code. Only code from trusted workspaces should be
 * executed here. For untrusted execution, a separate container boundary
 * is required (see takos-runtime container isolation).
 *
 * Mitigations in place:
 * - Outbound network restricted to allowed domains (SSRF protection)
 * - DNS rebinding prevention (resolved IPs checked for private ranges)
 * - Code generation disabled (no eval/new Function via codeGeneration option)
 * - Output size capped (MAX_OUTPUT_BYTES)
 * - Execution timeout enforced
 * - Timer count limited (MAX_ACTIVE_TIMERS)
 */

type ToolRequest = {
  code: string;
  toolName: string;
  parameters: Record<string, unknown>;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
  allowedDomains: string[];
  timeout: number;
};

type ToolResult = {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
};

const MAX_TOOL_CODE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB
const MAX_ACTIVE_TIMERS = 32;
const MAX_FETCH_REDIRECTS = 5;
const MAX_CONCURRENT_FETCHES = 10; // Per-execution fetch concurrency limit
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
type SandboxTimer = ReturnType<typeof setTimeout>;
type SandboxSetTimeout = (
  handler: unknown,
  delay?: number,
  ...args: unknown[]
) => SandboxTimer;
type SandboxClearTimeout = (timerId: SandboxTimer) => void;

const TRUST_MODEL_NOTE =
  'tool-worker vm is not a strong security boundary; only trusted workspace code is supported';

if (!parentPort) {
  throw new Error('Tool worker started without parent port');
}

function clampTimeout(timeout: unknown): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(timeout), 1), MAX_TIMEOUT_MS);
}

function toPlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return { ...(value as Record<string, unknown>) };
}

function deepFreeze<T>(value: T, visited: WeakSet<object> = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') {
    return value;
  }

  const objectValue = value as object;
  if (visited.has(objectValue)) {
    return value;
  }
  visited.add(objectValue);

  for (const nestedValue of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nestedValue, visited);
  }

  Object.freeze(objectValue);
  return value;
}

function serializeToolOutput(result: unknown): string {
  if (typeof result === 'string') return result;
  return JSON.stringify(result, null, 2) ?? 'null';
}

function postResult(startTime: number, result: Partial<ToolResult>): void {
  const response: ToolResult = {
    success: result.success ?? false,
    output: result.output ?? '',
    error: result.error,
    executionTime: Date.now() - startTime,
  };
  parentPort?.postMessage(response);
}

function createSandboxTimers(timeoutMs: number): {
  setTimeout: SandboxSetTimeout;
  clearTimeout: SandboxClearTimeout;
  clearAll: () => void;
} {
  const activeTimers = new Set<SandboxTimer>();

  const sandboxSetTimeout: SandboxSetTimeout = (handler, delay, ...args) => {
    if (typeof handler !== 'function') {
      throw new Error('setTimeout handler must be a function');
    }
    if (activeTimers.size >= MAX_ACTIVE_TIMERS) {
      throw new Error(`Timer limit exceeded (max ${MAX_ACTIVE_TIMERS})`);
    }

    const numericDelay = typeof delay === 'number' && Number.isFinite(delay) ? delay : 0;
    const clampedDelay = Math.max(0, Math.min(Math.floor(numericDelay), timeoutMs));

    const timer = setTimeout(() => {
      activeTimers.delete(timer);
      try {
        handler(...args);
      } catch (err) {
        logger.error('[Tool Timer Error]', { error: getErrorMessage(err) });
      }
    }, clampedDelay);
    activeTimers.add(timer);
    return timer;
  };

  const sandboxClearTimeout: SandboxClearTimeout = (timerId) => {
    if (activeTimers.delete(timerId)) {
      clearTimeout(timerId);
    }
  };

  const clearAll = (): void => {
    for (const timer of activeTimers) {
      clearTimeout(timer);
    }
    activeTimers.clear();
  };

  return {
    setTimeout: sandboxSetTimeout,
    clearTimeout: sandboxClearTimeout,
    clearAll,
  };
}

parentPort.on('message', async (message: ToolRequest) => {
  const startTime = Date.now();
  const timeout = clampTimeout(message.timeout);

  try {
    if (!TOOL_NAME_PATTERN.test(message.toolName)) {
      throw new Error('Invalid toolName format');
    }
    if (typeof message.code !== 'string' || message.code.trim().length === 0) {
      throw new Error('Tool code is required');
    }
    if (Buffer.byteLength(message.code, 'utf-8') > MAX_TOOL_CODE_BYTES) {
      throw new Error(`Tool code exceeds size limit (${MAX_TOOL_CODE_BYTES} bytes)`);
    }

    const allowedDomains = normalizeAllowedDomains(message.allowedDomains);
    const parameters = deepFreeze(toPlainRecord(message.parameters, 'parameters'));
    const secrets = deepFreeze(toPlainRecord(message.secrets, 'secrets'));
    const config = deepFreeze(toPlainRecord(message.config, 'config'));
    const timers = createSandboxTimers(timeout);

    let activeFetchCount = 0;

    const restrictedFetch = async (url: unknown, init?: RequestInit): Promise<Response> => {
      if (activeFetchCount >= MAX_CONCURRENT_FETCHES) {
        throw new Error(`Fetch concurrency limit exceeded (max ${MAX_CONCURRENT_FETCHES})`);
      }
      activeFetchCount++;
      try {
        let targetUrl = parseFetchUrl(url);
        let requestInit: RequestInit = {
          ...init,
          redirect: 'manual',
        };

        for (let redirectCount = 0; redirectCount <= MAX_FETCH_REDIRECTS; redirectCount++) {
          await assertOutboundUrlAllowed(targetUrl, allowedDomains);
          const response = await fetch(targetUrl, requestInit);

          if (!REDIRECT_STATUS_CODES.has(response.status)) {
            return response;
          }

          const locationHeader = response.headers.get('location');
          if (!locationHeader) {
            throw new Error(`Network access denied: redirect response from ${targetUrl.hostname} missing location`);
          }
          if (redirectCount >= MAX_FETCH_REDIRECTS) {
            throw new Error(`Network access denied: too many redirects (max ${MAX_FETCH_REDIRECTS})`);
          }

          const nextUrl = new URL(locationHeader, targetUrl);
          const method = (requestInit.method ?? 'GET').toUpperCase();
          if ((response.status === 307 || response.status === 308) && requestInit.body !== undefined) {
            throw new Error('Network access denied: redirected requests with body are not supported');
          }
          if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
            requestInit = {
              ...requestInit,
              method: 'GET',
              body: undefined,
            };
          }

          targetUrl = nextUrl;
        }

        throw new Error(`Network access denied: too many redirects (max ${MAX_FETCH_REDIRECTS})`);
      } finally {
        activeFetchCount--;
      }
    };

    logger.warn('[ToolWorker] ' + TRUST_MODEL_NOTE, { toolName: message.toolName });

    const sandboxContext = {
      fetch: restrictedFetch,
      // eslint-disable-next-line no-console -- intentional console proxy for sandboxed tool output
      console: Object.freeze({
        log: (...args: unknown[]) => console.log('[Tool]', ...args),
        error: (...args: unknown[]) => console.error('[Tool]', ...args),
        warn: (...args: unknown[]) => console.warn('[Tool]', ...args),
      }),
      parameters,
      secrets,
      config,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      AbortController,
      setTimeout: timers.setTimeout,
      clearTimeout: timers.clearTimeout,
      // Explicitly block known escape vectors
      process: undefined,
      require: undefined,
      global: undefined,
      Buffer: undefined,
      __dirname: undefined,
      __filename: undefined,
    };

    (sandboxContext as Record<string, unknown>).globalThis = sandboxContext;

    const context = vm.createContext(sandboxContext, {
      codeGeneration: { strings: false, wasm: false },
    });

    const wrappedCode = `
      (async function(sandbox) {
        "use strict";
        const exports = {};
        const module = { exports };
        const requestedToolName = ${JSON.stringify(message.toolName)};
        const { fetch, console, parameters, secrets, config, setTimeout, clearTimeout } = sandbox;

        ${message.code}

        const exportedTools =
          module.exports && typeof module.exports === 'object'
            ? module.exports
            : exports;
        const hasRequestedTool = Object.prototype.hasOwnProperty.call(exportedTools, requestedToolName);
        const toolFn = hasRequestedTool ? exportedTools[requestedToolName] : null;

        if (typeof toolFn !== 'function') {
          throw new Error('Tool function not found: ' + requestedToolName);
        }

        return await toolFn(parameters, { secrets, config, fetch });
      })
    `;

    const script = new vm.Script(wrappedCode, { filename: 'tool-worker.js' });
    let executionTimer: ReturnType<typeof setTimeout> | undefined;
    let result: unknown;

    try {
      const runner = script.runInContext(context);
      if (typeof runner !== 'function') {
        throw new Error('Tool runner initialization failed');
      }

      result = await Promise.race([
        Promise.resolve(runner(sandboxContext)),
        new Promise<never>((_, reject) => {
          executionTimer = setTimeout(() => {
            reject(new Error(`Execution timed out after ${timeout}ms`));
          }, timeout);
        }),
      ]);
    } finally {
      if (executionTimer) clearTimeout(executionTimer);
      timers.clearAll();
    }

    const output = serializeToolOutput(result);
    if (Buffer.byteLength(output, 'utf-8') > MAX_OUTPUT_BYTES) {
      throw new Error(`Tool output exceeds size limit (${MAX_OUTPUT_BYTES} bytes)`);
    }

    postResult(startTime, { success: true, output });
  } catch (err) {
    postResult(startTime, { error: getErrorMessage(err) });
  }
});
