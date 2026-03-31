/**
 * Proxy authentication, capability mapping, and resource access validation
 * for the executor-host subsystem.
 */

import type { ProxyCapability } from './executor-utils.ts';

// ---------------------------------------------------------------------------
// Allowed path patterns for service-to-service proxy forwarding
// ---------------------------------------------------------------------------

export const ALLOWED_RUNTIME_PROXY_PATHS = [
  /^\/session(?:\/|$)/,
  /^\/status(?:\/|$)/,
  /^\/repos(?:\/|$)/,
  /^\/actions\/jobs\/[^/]+$/,
  /^\/cli-proxy\/.+/,
] as const;

export const ALLOWED_BROWSER_PROXY_PATHS = [
  /^\/create$/,
  /^\/session\/[^/]+$/,
  /^\/session\/[^/]+\/(?:goto|action|extract|pdf|tab\/new|tab\/close|tab\/switch)$/,
  /^\/session\/[^/]+\/(?:html|screenshot|tabs)$/,
] as const;

// ---------------------------------------------------------------------------
// Proxy capability resolution
// ---------------------------------------------------------------------------

export function getRequiredProxyCapability(path: string): ProxyCapability | null {
  if (
    path.startsWith('/proxy/db/')
    || path.startsWith('/proxy/offload/')
    || path.startsWith('/proxy/git-objects/')
    || path.startsWith('/proxy/do/')
    || path.startsWith('/proxy/vectorize/')
    || path.startsWith('/proxy/ai/')
    || path.startsWith('/proxy/egress/')
    || path.startsWith('/proxy/runtime/')
    || path.startsWith('/proxy/browser/')
    || path.startsWith('/proxy/queue/')
  ) {
    return 'bindings';
  }

  if (
    path === '/proxy/heartbeat'
    || path === '/proxy/run/status'
    || path === '/proxy/run/fail'
    || path === '/proxy/run/reset'
    || path === '/proxy/api-keys'
    || path === '/proxy/billing/run-usage'
    || path === '/rpc/control/heartbeat'
    || path === '/rpc/control/run-status'
    || path === '/rpc/control/run-record'
    || path === '/rpc/control/run-bootstrap'
    || path === '/rpc/control/run-fail'
    || path === '/rpc/control/run-reset'
    || path === '/rpc/control/api-keys'
    || path === '/rpc/control/billing-run-usage'
    || path === '/rpc/control/run-context'
    || path === '/rpc/control/no-llm-complete'
    || path === '/rpc/control/conversation-history'
    || path === '/rpc/control/skill-plan'
    || path === '/rpc/control/memory-activation'
    || path === '/rpc/control/memory-finalize'
    || path === '/rpc/control/add-message'
    || path === '/rpc/control/update-run-status'
    || path === '/rpc/control/current-session'
    || path === '/rpc/control/is-cancelled'
    || path === '/rpc/control/tool-catalog'
    || path === '/rpc/control/tool-execute'
    || path === '/rpc/control/tool-cleanup'
    || path === '/rpc/control/run-event'
  ) {
    return 'control';
  }

  // Unknown proxy paths must be rejected — return null signals unauthorized
  return null;
}

// ---------------------------------------------------------------------------
// Resource-level access validation
// ---------------------------------------------------------------------------

export function validateProxyResourceAccess(
  path: string,
  claims: Record<string, unknown>,
  body: Record<string, unknown>,
): boolean {
  const claimRunId = typeof claims.run_id === 'string' ? claims.run_id : null;

  if (path === '/proxy/do/fetch') {
    return body.namespace === 'RUN_NOTIFIER'
      && typeof body.name === 'string'
      && !!claimRunId
      && body.name === claimRunId;
  }

  if (path === '/proxy/queue/send' || path === '/proxy/queue/send-batch') {
    return body.queue === 'index';
  }

  if (path === '/proxy/runtime/fetch') {
    if (typeof body.url !== 'string') {
      return false;
    }

    try {
      const runtimeUrl = new URL(body.url);
      return runtimeUrl.hostname === 'runtime-host'
        && ALLOWED_RUNTIME_PROXY_PATHS.some((pattern) => pattern.test(runtimeUrl.pathname));
    } catch {
      return false;
    }
  }

  if (path === '/proxy/browser/fetch') {
    if (typeof body.url !== 'string') {
      return false;
    }

    try {
      const browserUrl = new URL(body.url);
      return browserUrl.hostname === 'browser-host.internal'
        && ALLOWED_BROWSER_PROXY_PATHS.some((pattern) => pattern.test(browserUrl.pathname));
    } catch {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Claims / body matching
// ---------------------------------------------------------------------------

export function claimsMatchRequestBody(
  claims: Record<string, unknown>,
  body: Record<string, unknown>,
): boolean {
  const claimRunId = typeof claims.run_id === 'string' ? claims.run_id : null;
  const claimServiceId = typeof claims.service_id === 'string'
    ? claims.service_id
    : typeof claims.worker_id === 'string'
      ? claims.worker_id
      : null;
  const bodyRunId = typeof body.runId === 'string' ? body.runId : null;
  const bodyServiceId = typeof body.serviceId === 'string'
    ? body.serviceId
    : typeof body.workerId === 'string'
      ? body.workerId
      : null;

  if (claimRunId && bodyRunId && claimRunId !== bodyRunId) return false;
  if (claimServiceId && bodyServiceId && claimServiceId !== bodyServiceId) return false;
  return true;
}
