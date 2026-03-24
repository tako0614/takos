// Egress handler module (fetch).
// Outbound fetch proxy with SSRF protection (service-binding only).
// Imported by the unified takos-worker entrypoint (src/runtime/worker/index.ts).

import type { DurableObjectNamespace } from '../../shared/types/bindings.ts';
function normalizeHostname(hostname: string): string {
  const stripped = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[([^\]]+)\]$/, '$1');
  return stripped.endsWith('.') ? stripped.slice(0, -1) : stripped;
}
import { isPrivateIP } from '@takos/common/validation';
import { validateEgressEnv, createEnvGuard } from '../../shared/utils/validate-env';
import { logError, logInfo, logWarn } from '../../shared/utils/logger';

interface Env {
  RATE_LIMITER_DO?: DurableObjectNamespace;
  EGRESS_MAX_REQUESTS?: string; // default 300
  EGRESS_WINDOW_MS?: string; // default 60000
  EGRESS_RATE_LIMIT_ALGORITHM?: string; // sliding_window | token_bucket | shadow
  EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE?: string; // 0..1 (only used for shadow logging)
  EGRESS_MAX_RESPONSE_BYTES?: string; // default 26214400 (25MB)
  EGRESS_TIMEOUT_MS?: string; // default 300000 (5 min)
}

type RateLimiterNamespace = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
};

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';

const DEFAULT_MAX_REQUEST_BYTES = 10 * 1024 * 1024; // 10MB
const DEFAULT_MAX_REQUESTS = 300;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25MB
const DEFAULT_TIMEOUT_MS = 300_000; // 5 min

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'kubernetes.default.svc',
  'kubernetes.default.svc.cluster.local',
]);

const BLOCKED_HOSTNAME_PATTERNS = [
  /^localhost\./i,
  /\.localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^.*\.svc\.cluster\.local$/i,
];


function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (BLOCKED_HOSTNAME_PATTERNS.some((p) => p.test(h))) return true;
  if (isPrivateIP(h)) return true;

  return false;
}

async function dohResolve(name: string, type: 'A' | 'AAAA' | 'CNAME'): Promise<{
  status: number;
  answers: Array<{ type: number; data: string }>;
}> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/dns-json' },
    redirect: 'manual',
  });
  if (!res.ok) {
    throw new Error(`DoH query failed: ${res.status}`);
  }
  const json = await res.json() as {
    Status?: number;
    Answer?: Array<{ type: number; data: string }>;
  };
  return {
    status: json.Status ?? 2,
    answers: json.Answer ?? [],
  };
}

async function resolveAllIPs(hostname: string): Promise<string[]> {
  const visited = new Set<string>();
  const ips: string[] = [];

  async function walk(name: string, depth: number): Promise<void> {
    if (depth > 10) throw new Error('DNS resolution exceeded max depth');
    const n = normalizeHostname(name);
    if (visited.has(n)) return;
    visited.add(n);

    // A and AAAA responses include CNAME records in the answer section,
    // so a separate CNAME query is unnecessary.
    const [a, aaaa] = await Promise.all([
      dohResolve(n, 'A'),
      dohResolve(n, 'AAAA'),
    ]);

    const allAnswers = [...a.answers, ...aaaa.answers];

    for (const ans of allAnswers) {
      if (ans.type === 1 && typeof ans.data === 'string') ips.push(ans.data);
      if (ans.type === 28 && typeof ans.data === 'string') ips.push(ans.data);
    }

    const cnameTargets = new Set(
      allAnswers
        .filter((ans) => ans.type === 5 && typeof ans.data === 'string')
        .map((ans) => normalizeHostname(ans.data)),
    );

    for (const cn of cnameTargets) {

      await walk(cn, depth + 1);
    }
  }

  await walk(hostname, 0);
  return [...new Set(ips)];
}

function portOf(url: URL): number {
  if (url.port) return parseInt(url.port, 10);
  return url.protocol === 'https:' ? 443 : 80;
}

function sanitizeOutboundHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    const k = key.toLowerCase();

    if (k === 'connection' || k === 'keep-alive' || k === 'proxy-connection' || k === 'transfer-encoding' || k === 'upgrade') return;
    if (k === 'host' || k === 'content-length' || k === 'expect') return;
    if (k.startsWith('cf-')) return;
    if (k.startsWith('x-takos-')) return;
    if (k === 'x-forwarded-for' || k === 'x-forwarded-host' || k === 'x-real-ip') return;

    out.set(key, value);
  });
  return out;
}

async function rateLimitIfConfigured(env: Env, spaceId: string | null): Promise<{ allowed: boolean; info?: unknown }> {
  if (!env.RATE_LIMITER_DO) return { allowed: true };
  if (!spaceId) return { allowed: true };

  const maxRequests = Math.max(1, parseInt(env.EGRESS_MAX_REQUESTS || String(DEFAULT_MAX_REQUESTS), 10) || DEFAULT_MAX_REQUESTS);
  const windowMs = Math.max(1, parseInt(env.EGRESS_WINDOW_MS || String(DEFAULT_WINDOW_MS), 10) || DEFAULT_WINDOW_MS);
  const algorithmRaw = String(env.EGRESS_RATE_LIMIT_ALGORITHM || '').trim();
  const algorithm = (algorithmRaw === 'sliding_window' || algorithmRaw === 'token_bucket' || algorithmRaw === 'shadow')
    ? algorithmRaw
    : null;
  const shadowSampleRateValue = env.EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE != null
    ? Number.parseFloat(String(env.EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE))
    : Number.NaN;

  try {
    const namespace = env.RATE_LIMITER_DO as unknown as RateLimiterNamespace;
    const id = namespace.idFromName(`egress:${spaceId}`);
    const stub = namespace.get(id);
    const body: Record<string, unknown> = { key: `egress:${spaceId}`, maxRequests, windowMs };
    if (algorithm) {
      body.algorithm = algorithm;
      if (algorithm === 'shadow' && Number.isFinite(shadowSampleRateValue)) {
        body.shadowSampleRate = Math.max(0, Math.min(1, shadowSampleRateValue));
      }
    }
    const res = await stub.fetch('http://rate-limiter/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json() as { allowed?: boolean; remaining?: number; reset?: number; total?: number };
    if (json.allowed === false) return { allowed: false, info: json };
    return { allowed: true, info: json };
  } catch (e) {
    logError('rate limiter DO error', e, { module: 'egress' });
    return { allowed: true };
  }
}

function safeLogUrl(url: URL): { protocol: string; hostname: string; port: number; path: string; hasQuery: boolean } {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: portOf(url),
    path: url.pathname,
    hasQuery: url.search.length > 0,
  };
}

// Cached environment validation guard.
const envGuard = createEnvGuard(validateEgressEnv);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Validate environment on first request (cached).
    const envError = envGuard(env as unknown as Record<string, unknown>);
    if (envError) {
      return new Response(JSON.stringify({
        error: 'Configuration Error',
        message: 'Egress worker is misconfigured. Please contact administrator.',
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }

    const startedAt = Date.now();

    // Service binding callers set X-Takos-Internal: 1 — required for all requests
    const isInternal = request.headers.get('X-Takos-Internal') === '1';

    if (!isInternal) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid URL' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const spaceId = request.headers.get('X-Takos-Space-Id');
    const runId = request.headers.get('X-Takos-Run-Id');
    const mode = request.headers.get('X-Takos-Egress-Mode');

    if (!['http:', 'https:'].includes(url.protocol)) {
      return new Response(JSON.stringify({ error: 'Only HTTP/HTTPS URLs are allowed' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (url.username || url.password) {
      return new Response(JSON.stringify({ error: 'URLs with credentials are not allowed' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    url.hostname = normalizeHostname(url.hostname);

    if (!url.hostname.includes('.') && !url.hostname.includes(':')) {
      return new Response(JSON.stringify({ error: 'Hostname must be a public FQDN' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const port = portOf(url);
    if (![80, 443].includes(port)) {
      return new Response(JSON.stringify({ error: `Port ${port} is not allowed` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    if (isBlockedHostname(url.hostname)) {
      logWarn('blocked hostname', { module: 'egress', ...{ url: safeLogUrl(url), spaceId, runId, mode } });
      return new Response(JSON.stringify({ error: 'Access to internal/private networks is not allowed' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    let ips: string[] = [];
    try {
      ips = await resolveAllIPs(url.hostname);
    } catch (e) {
      logWarn('DNS resolve failed', { module: 'egress', ...{ url: safeLogUrl(url), err: String(e) } });
      return new Response(JSON.stringify({ error: 'DNS resolution failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    if (ips.length === 0) {
      logWarn('DNS resolve empty', { module: 'egress', ...{ url: safeLogUrl(url) } });
      return new Response(JSON.stringify({ error: 'DNS resolution returned no addresses' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    for (const ip of ips) {
      if (isPrivateIP(ip)) {
        logWarn('blocked resolved IP', { module: 'egress', ...{ url: safeLogUrl(url), ip } });
        return new Response(JSON.stringify({ error: 'Resolved to private/internal IP address' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // DNS rebinding mitigation: DNS was resolved via DoH above, and the actual
    // fetch uses CF edge DNS. Redirects are blocked (redirect: 'manual'), so
    // an attacker cannot redirect to a different host post-validation.

    const rl = await rateLimitIfConfigured(env, spaceId);
    if (!rl.allowed) {
      logWarn('rate limited', { module: 'egress', ...{ spaceId, runId, mode, info: rl.info } });
      return new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    const maxBytes = Math.max(
      1,
      parseInt(env.EGRESS_MAX_RESPONSE_BYTES || String(DEFAULT_MAX_RESPONSE_BYTES), 10) || DEFAULT_MAX_RESPONSE_BYTES
    );
    const timeoutMs = Math.max(
      1,
      parseInt(env.EGRESS_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS
    );

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const outboundHeaders = sanitizeOutboundHeaders(request.headers);

    const contentLength = request.headers.get('content-length');
    if (contentLength) {
      const requestSize = parseInt(contentLength, 10);
      if (requestSize > DEFAULT_MAX_REQUEST_BYTES) {
        return new Response(JSON.stringify({ error: 'Request body too large' }), { status: 413, headers: { 'Content-Type': 'application/json' } });
      }
    }

    let upstream: Response;
    try {
      upstream = await fetch(url.toString(), {
        method: request.method,
        headers: outboundHeaders,
        body: request.body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (e) {
      const elapsedMs = Date.now() - startedAt;
      logError('upstream fetch failed', { url: safeLogUrl(url), spaceId, runId, mode, elapsedMs, err: String(e) }, { module: 'egress' });
      return new Response(JSON.stringify({ error: 'Upstream fetch failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    } finally {
      clearTimeout(timeoutId);
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      logWarn('redirect blocked', { module: 'egress', ...{
        url: safeLogUrl(url),
        status: upstream.status,
        location: Boolean(upstream.headers.get('location')),
        spaceId,
        runId,
        mode,
      } });
      return new Response(JSON.stringify({ error: 'Redirects are not allowed' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Early rejection if Content-Length exceeds limit
    const upstreamContentLength = upstream.headers.get('content-length');
    if (upstreamContentLength && parseInt(upstreamContentLength, 10) > maxBytes) {
      return new Response(JSON.stringify({ error: 'Response too large' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const resHeaders = new Headers();
    const contentType = upstream.headers.get('content-type');
    if (contentType) resHeaders.set('Content-Type', contentType);
    resHeaders.set('Cache-Control', 'no-store');

    if (!upstream.body) {
      logInfo('ok', { module: 'egress', ...{ url: safeLogUrl(url), status: upstream.status, bytes: 0, elapsedMs: Date.now() - startedAt, spaceId, runId, mode } });
      return new Response(null, { status: upstream.status, headers: resHeaders });
    }

    // Stream through with size limit enforcement
    let total = 0;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new Error('Response too large'));
          return;
        }
        controller.enqueue(chunk);
      },
      flush() {
        logInfo('ok', { module: 'egress', ...{ url: safeLogUrl(url), status: upstream.status, bytes: total, elapsedMs: Date.now() - startedAt, spaceId, runId, mode } });
      },
    });

    upstream.body.pipeTo(writable).catch(() => {});

    return new Response(readable, { status: upstream.status, headers: resHeaders });
  },
};
