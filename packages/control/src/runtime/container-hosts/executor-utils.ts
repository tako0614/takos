/**
 * Shared utility functions, response helpers, and types for the executor-host
 * subsystem.  All proxy handlers and the main fetch entrypoint depend on these.
 */

import type {
  DurableObjectNamespace,
  R2Bucket,
  Queue,
} from '../../shared/types/bindings.ts';
import type {
  DbEnv,
  StorageEnv,
  AiEnv,
  IndexJobQueueMessage,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Environment types
// ---------------------------------------------------------------------------

export interface AgentExecutorEnv extends DbEnv, StorageEnv, AiEnv {
  EXECUTOR_CONTAINER: ContainerNamespace;
  RUN_NOTIFIER: DurableObjectNamespace;
  TAKOS_OFFLOAD: R2Bucket;
  TAKOS_EGRESS: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  RUNTIME_HOST?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  BROWSER_HOST?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  /** Service binding to main takos-web worker for control RPC forwarding. */
  TAKOS_CONTROL?: { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
  /** Shared secret for authenticating forwarded requests to the main worker. */
  EXECUTOR_PROXY_SECRET?: string;
  INDEX_QUEUE?: Queue<IndexJobQueueMessage>;
  CONTROL_RPC_BASE_URL?: string;
}

// Local alias for internal usage across sub-modules
export type Env = AgentExecutorEnv;

// ---------------------------------------------------------------------------
// Container stub / namespace interfaces
// ---------------------------------------------------------------------------

import type {
  AgentExecutorDispatchPayload,
  AgentExecutorDispatchResult,
} from './executor-dispatch';

/** Token metadata stored alongside each random proxy token. */
export interface ProxyTokenInfo {
  runId: string;
  serviceId: string;
  capability: ProxyCapability;
}

export interface ExecutorContainerStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  dispatchStart(body: AgentExecutorDispatchPayload): Promise<AgentExecutorDispatchResult>;
  verifyProxyToken(token: string): Promise<ProxyTokenInfo | null>;
}

export interface ContainerNamespace extends DurableObjectNamespace {
  get(id: unknown): ExecutorContainerStub;
  getByName(name: string): ExecutorContainerStub;
}

/**
 * Wrapper type for the Cloudflare AI binding that accepts dynamic model names.
 * The built-in `Ai` type requires a specific `AiModels` key, but proxy callers
 * send arbitrary model name strings resolved at runtime.
 */
export interface AiRunBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export type ProxyCapability = 'bindings' | 'control';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  });
}

export function err(message: string, status = 500): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

export function classifyProxyError(e: unknown): { status: number; message: string } {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);

  // Timeout / AbortError
  if (name === 'AbortError' || name === 'TimeoutError' || msg.includes('timed out') || msg.includes('timeout')) {
    return { status: 504, message: 'Proxy request timed out' };
  }

  // SQLite errors
  if (msg.includes('SQLITE_BUSY') || msg.includes('database is locked')) {
    return { status: 503, message: 'Database busy, retry later' };
  }
  if (msg.includes('SQLITE_CONSTRAINT')) {
    return { status: 409, message: 'Database constraint violation' };
  }
  if (msg.includes('SQLITE_ERROR') || msg.includes('D1_ERROR')) {
    return { status: 400, message: 'Database query error' };
  }

  // Network errors
  if (
    name === 'NetworkError' ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  ) {
    return { status: 502, message: 'Upstream connection failed' };
  }

  // Client-side type/range errors
  if (e instanceof TypeError || e instanceof RangeError) {
    return { status: 400, message: 'Invalid request' };
  }

  return { status: 500, message: 'Internal proxy error' };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function decodeBase64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function readRunServiceId(body: Record<string, unknown>): string | null {
  if (typeof body.serviceId === 'string' && body.serviceId.length > 0) return body.serviceId;
  if (typeof body.workerId === 'string' && body.workerId.length > 0) return body.workerId;
  return null;
}

// ---------------------------------------------------------------------------
// Proxy usage tracking
// ---------------------------------------------------------------------------

const proxyUsageCounters = new Map<string, number>();

export function recordProxyUsage(path: string): void {
  const bucket = path.startsWith('/proxy/db/')
    ? 'db'
    : path.startsWith('/proxy/offload/')
      ? 'offload'
      : path.startsWith('/proxy/do/')
        ? 'do'
        : path === '/rpc/control/tool-catalog'
          ? 'tool-catalog'
          : path === '/rpc/control/tool-execute'
            ? 'tool-execute'
            : path === '/rpc/control/tool-cleanup'
              ? 'tool-cleanup'
              : path === '/rpc/control/run-event'
                ? 'run-event'
                : path.startsWith('/proxy/')
                  ? 'other-proxy'
                  : path.startsWith('/rpc/control/')
                    ? 'other-control-rpc'
                    : 'other';
  proxyUsageCounters.set(bucket, (proxyUsageCounters.get(bucket) ?? 0) + 1);
}

export function getProxyUsageSnapshot(): Record<string, number> {
  return Object.fromEntries([...proxyUsageCounters.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------
// Control RPC forwarding (to main takos-web worker via service binding)
// ---------------------------------------------------------------------------

/**
 * Map from executor-host paths to the proxy API endpoint names.
 * Covers both /rpc/control/* and legacy /proxy/* paths that require
 * DB/service access in the main worker.
 */
const CONTROL_RPC_PATH_MAP: Record<string, string> = {
  '/rpc/control/heartbeat': '/internal/executor-rpc/heartbeat',
  '/proxy/heartbeat': '/internal/executor-rpc/heartbeat',
  '/rpc/control/run-status': '/internal/executor-rpc/run-status',
  '/proxy/run/status': '/internal/executor-rpc/run-status',
  '/rpc/control/run-record': '/internal/executor-rpc/run-record',
  '/rpc/control/run-bootstrap': '/internal/executor-rpc/run-bootstrap',
  '/rpc/control/run-fail': '/internal/executor-rpc/run-fail',
  '/proxy/run/fail': '/internal/executor-rpc/run-fail',
  '/rpc/control/run-reset': '/internal/executor-rpc/run-reset',
  '/proxy/run/reset': '/internal/executor-rpc/run-reset',
  '/rpc/control/run-context': '/internal/executor-rpc/run-context',
  '/rpc/control/no-llm-complete': '/internal/executor-rpc/no-llm-complete',
  '/rpc/control/current-session': '/internal/executor-rpc/current-session',
  '/rpc/control/is-cancelled': '/internal/executor-rpc/is-cancelled',
  '/rpc/control/conversation-history': '/internal/executor-rpc/conversation-history',
  '/rpc/control/skill-plan': '/internal/executor-rpc/skill-plan',
  '/rpc/control/memory-activation': '/internal/executor-rpc/memory-activation',
  '/rpc/control/memory-finalize': '/internal/executor-rpc/memory-finalize',
  '/rpc/control/add-message': '/internal/executor-rpc/add-message',
  '/rpc/control/update-run-status': '/internal/executor-rpc/update-run-status',
  '/rpc/control/tool-catalog': '/internal/executor-rpc/tool-catalog',
  '/rpc/control/tool-execute': '/internal/executor-rpc/tool-execute',
  '/rpc/control/tool-cleanup': '/internal/executor-rpc/tool-cleanup',
  '/rpc/control/run-event': '/internal/executor-rpc/run-event',
  '/rpc/control/billing-run-usage': '/internal/executor-rpc/billing-run-usage',
  '/proxy/billing/run-usage': '/internal/executor-rpc/billing-run-usage',
  '/rpc/control/api-keys': '/internal/executor-rpc/api-keys',
  '/proxy/api-keys': '/internal/executor-rpc/api-keys',
};

/**
 * Check if a path should be forwarded to the control plane.
 */
export function isControlRpcPath(path: string): boolean {
  return path in CONTROL_RPC_PATH_MAP;
}

/**
 * Forward a control RPC request to the main takos-web worker.
 * Returns null if TAKOS_CONTROL is not configured (fall through to legacy handlers).
 */
export async function forwardToControlPlane(
  path: string,
  body: Record<string, unknown>,
  env: Env,
): Promise<Response | null> {
  const controlBinding = env.TAKOS_CONTROL;
  if (!controlBinding) return null;

  const targetPath = CONTROL_RPC_PATH_MAP[path];
  if (!targetPath) return null;

  try {
    return await controlBinding.fetch(
      new Request(`https://internal${targetPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Takos-Internal': env.EXECUTOR_PROXY_SECRET ?? '',
        },
        body: JSON.stringify(body),
      }),
    );
  } catch (e) {
    return err(`Control plane forwarding failed: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
