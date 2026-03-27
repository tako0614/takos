import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { logInfo, logError } from '../shared/utils/logger.ts';
import { serveNodeFetch } from './fetch-server.ts';

type OciServiceStatus = 'deployed' | 'removed' | 'routing-only';

type OciServiceEndpoint =
  | {
      kind: 'service-ref';
      ref: string;
    }
  | {
      kind: 'http-url';
      base_url: string;
    };

type OciServiceRecord = {
  space_id: string;
  route_ref: string;
  deployment_id: string;
  artifact_ref: string;
  endpoint: OciServiceEndpoint;
  image_ref: string | null;
  exposed_port: number | null;
  health_path: string | null;
  container_id: string | null;
  resolved_endpoint: { kind: 'http-url'; base_url: string } | null;
  compatibility_date: string | null;
  compatibility_flags: string[];
  limits: {
    cpu_ms?: number;
    subrequests?: number;
  } | null;
  status: OciServiceStatus;
  health_status: 'unknown' | 'healthy' | 'unhealthy';
  last_health_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type OciOrchestratorState = {
  services: Record<string, OciServiceRecord>;
};

const DOCKER_SOCKET = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const DOCKER_NETWORK = process.env.TAKOS_DOCKER_NETWORK || 'takos-containers';
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;

// ─── Docker Engine API client via Unix socket ───

function dockerRequest(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path: apiPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown = raw;
        try { parsed = JSON.parse(raw); } catch { /* raw text */ }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Stream-based request for docker pull (returns chunked progress)
function dockerRequestStream(
  method: string,
  apiPath: string,
  body?: unknown,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path: apiPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      // Consume the stream to completion
      res.on('data', () => {});
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0 });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function dockerPull(imageRef: string): Promise<void> {
  // Parse image ref into fromImage and tag
  const parts = imageRef.split(':');
  const tag = parts.length > 1 ? parts[parts.length - 1] : 'latest';
  const fromImage = parts.length > 1 ? parts.slice(0, -1).join(':') : imageRef;
  const result = await dockerRequestStream(
    'POST',
    `/images/create?fromImage=${encodeURIComponent(fromImage)}&tag=${encodeURIComponent(tag)}`,
  );
  if (result.status !== 200) {
    throw new Error(`Docker pull failed with status ${result.status}`);
  }
}

async function dockerCreate(
  name: string,
  imageRef: string,
  exposedPort: number,
  envVars: string[],
  network: string,
): Promise<string> {
  const result = await dockerRequest('POST', `/containers/create?name=${encodeURIComponent(name)}`, {
    Image: imageRef,
    Env: envVars,
    ExposedPorts: { [`${exposedPort}/tcp`]: {} },
    HostConfig: {
      NetworkMode: network,
    },
  });
  if (result.status !== 201) {
    throw new Error(`Docker create failed with status ${result.status}: ${JSON.stringify(result.body)}`);
  }
  return (result.body as { Id: string }).Id;
}

async function dockerStart(containerId: string): Promise<void> {
  const result = await dockerRequest('POST', `/containers/${containerId}/start`);
  if (result.status !== 204 && result.status !== 304) {
    throw new Error(`Docker start failed with status ${result.status}`);
  }
}

async function dockerStop(containerId: string, timeoutSeconds = 10): Promise<void> {
  const result = await dockerRequest('POST', `/containers/${containerId}/stop?t=${timeoutSeconds}`);
  if (result.status !== 204 && result.status !== 304) {
    // Container may already be stopped
    if (result.status === 404) return;
    throw new Error(`Docker stop failed with status ${result.status}`);
  }
}

async function dockerRemove(containerId: string): Promise<void> {
  const result = await dockerRequest('DELETE', `/containers/${containerId}?force=true`);
  if (result.status !== 204 && result.status !== 404) {
    throw new Error(`Docker remove failed with status ${result.status}`);
  }
}

async function dockerLogs(containerId: string, tail = 100): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: http.RequestOptions = {
      socketPath: DOCKER_SOCKET,
      path: `/containers/${containerId}/logs?stdout=1&stderr=1&tail=${tail}&timestamps=1`,
      method: 'GET',
    };
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        // Docker multiplexed stream: 8-byte header per frame
        // Strip headers for clean log output
        const lines: string[] = [];
        let offset = 0;
        while (offset < raw.length) {
          if (offset + 8 > raw.length) break;
          const size = raw.readUInt32BE(offset + 4);
          offset += 8;
          if (offset + size > raw.length) break;
          lines.push(raw.subarray(offset, offset + size).toString('utf8'));
          offset += size;
        }
        resolve(lines.join(''));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function pollHealthCheck(
  containerName: string,
  port: number,
  healthPath: string,
  timeoutMs: number,
): Promise<boolean> {
  const normalizedPath = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const result = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: containerName, port, path: normalizedPath, method: 'GET', timeout: 5000 },
          (res) => {
            res.on('data', () => {});
            res.on('end', () => resolve(res.statusCode ?? 0));
          },
        );
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
      });
      if (result >= 200 && result < 400) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

function containerName(spaceId: string, routeRef: string): string {
  // Sanitize for Docker container naming
  return `takos-${spaceId}-${routeRef}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 128);
}

const deploySchema = z.object({
  deployment_id: z.string().min(1),
  space_id: z.string().min(1),
  artifact_ref: z.string().min(1),
  target: z.object({
    route_ref: z.string().min(1),
    endpoint: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('service-ref'),
        ref: z.string().min(1),
      }).strict(),
      z.object({
        kind: z.literal('http-url'),
        base_url: z.string().url(),
      }).strict(),
    ]),
    artifact: z.object({
      image_ref: z.string().min(1).optional(),
      exposed_port: z.number().int().positive().optional(),
      health_path: z.string().min(1).optional(),
    }).strict().optional(),
  }).strict(),
  runtime: z.object({
    compatibility_date: z.string().min(1).optional().nullable(),
    compatibility_flags: z.array(z.string()).default([]),
    limits: z.object({
      cpu_ms: z.number().int().positive().optional(),
      subrequests: z.number().int().positive().optional(),
    }).optional().nullable(),
  }).strict().optional(),
});

const serviceActionSchema = z.object({
  space_id: z.string().min(1),
});

function resolveDataDir(): string {
  const explicit = process.env.OCI_ORCHESTRATOR_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const localDir = process.env.TAKOS_LOCAL_DATA_DIR?.trim();
  if (localDir) {
    return path.resolve(localDir, 'oci-orchestrator');
  }
  return path.resolve(process.cwd(), '.takos-local-oci-orchestrator');
}

function resolvePort(): number {
  const parsed = Number.parseInt(process.env.PORT ?? process.env.OCI_ORCHESTRATOR_PORT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 9002;
}

function serviceKey(spaceId: string, routeRef: string): string {
  return `${spaceId}::${routeRef}`;
}

function logPathFor(spaceId: string, routeRef: string): string {
  return path.join(resolveDataDir(), 'logs', `${spaceId}-${routeRef}.log`);
}

function statePath(): string {
  return path.join(resolveDataDir(), 'state.json');
}

async function ensureStorageDirs(): Promise<void> {
  await mkdir(path.join(resolveDataDir(), 'logs'), { recursive: true });
}

async function loadState(): Promise<OciOrchestratorState> {
  try {
    const raw = await readFile(statePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<OciOrchestratorState>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { services: {} };
    }
    return {
      services: parsed.services && typeof parsed.services === 'object' ? parsed.services as Record<string, OciServiceRecord> : {},
    };
  } catch {
    return { services: {} };
  }
}

async function saveState(state: OciOrchestratorState): Promise<void> {
  await ensureStorageDirs();
  await writeFile(statePath(), `${JSON.stringify(state, null, 2)}\n`);
}

async function appendServiceLog(spaceId: string, serviceName: string, line: string): Promise<void> {
  await ensureStorageDirs();
  await appendFile(logPathFor(spaceId, serviceName), `${new Date().toISOString()} ${line}\n`);
}

function tailLines(text: string, tail: number): string {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  return `${lines.slice(Math.max(0, lines.length - tail)).join('\n')}${lines.length > 0 ? '\n' : ''}`;
}

function createAuthMiddleware() {
  const token = process.env.OCI_ORCHESTRATOR_TOKEN?.trim();
  return async (c: Context, next: Next) => {
    if (!token) {
      return next();
    }
    const auth = c.req.header('Authorization')?.trim();
    if (auth !== `Bearer ${token}`) {
      return c.text('Unauthorized', 401);
    }
    return next();
  };
}

async function stopAndRemoveContainer(record: OciServiceRecord, spaceId: string, routeRef: string): Promise<void> {
  if (!record.container_id) return;
  try {
    await dockerStop(record.container_id);
    await dockerRemove(record.container_id);
    await appendServiceLog(spaceId, routeRef, `CONTAINER_REMOVED ${record.container_id}`);
  } catch (err) {
    logError(`Failed to stop/remove container ${record.container_id}`, err, { module: 'oci-orchestrator' });
  }
}

export function createLocalOciOrchestratorApp(): Hono {
  const app = new Hono();

  app.use('*', createAuthMiddleware());

  app.get('/health', (c) => c.json({
    status: 'ok',
    service: 'oci-orchestrator',
  }));

  app.post('/deploy', async (c) => {
    const parsed = deploySchema.safeParse(await c.req.json());
    if (!parsed.success) {
      return c.json({
        error: 'invalid deploy payload',
        issues: parsed.error.issues,
      }, 400);
    }
    const payload = parsed.data;
    const routeRef = payload.target.route_ref.trim();
    const now = new Date().toISOString();
    const key = serviceKey(payload.space_id, routeRef);
    const state = await loadState();
    const previous = state.services[key];
    const imageRef = payload.target.artifact?.image_ref ?? null;
    const exposedPort = payload.target.artifact?.exposed_port ?? 8080;
    const healthPath = payload.target.artifact?.health_path ?? '/health';
    const runtime: {
      compatibility_date?: string | null;
      compatibility_flags?: string[];
      limits?: {
        cpu_ms?: number;
        subrequests?: number;
      } | null;
    } = payload.runtime ?? {};

    let newContainerId: string | null = null;
    let resolvedEndpoint: { kind: 'http-url'; base_url: string } | null = null;

    if (imageRef) {
      const cName = containerName(payload.space_id, routeRef);

      try {
        // Stop and remove previous container if exists
        if (previous?.container_id) {
          await stopAndRemoveContainer(previous, payload.space_id, routeRef);
        }

        // Also try removing by name in case state was out of sync
        try {
          const inspectResult = await dockerRequest('GET', `/containers/${encodeURIComponent(cName)}/json`);
          if (inspectResult.status === 200) {
            const existingId = (inspectResult.body as { Id: string }).Id;
            await dockerStop(existingId);
            await dockerRemove(existingId);
          }
        } catch { /* container doesn't exist, fine */ }

        await appendServiceLog(payload.space_id, routeRef, `PULLING ${imageRef}`);
        await dockerPull(imageRef);

        await appendServiceLog(payload.space_id, routeRef, `CREATING container ${cName}`);
        newContainerId = await dockerCreate(cName, imageRef, exposedPort, [], DOCKER_NETWORK);

        await appendServiceLog(payload.space_id, routeRef, `STARTING container ${newContainerId.slice(0, 12)}`);
        await dockerStart(newContainerId);

        // Poll health check
        await appendServiceLog(payload.space_id, routeRef, `HEALTH_CHECK polling ${cName}:${exposedPort}${healthPath}`);
        const healthy = await pollHealthCheck(cName, exposedPort, healthPath, HEALTH_TIMEOUT_MS);

        if (!healthy) {
          await appendServiceLog(payload.space_id, routeRef, `HEALTH_CHECK failed, removing container`);
          await dockerStop(newContainerId);
          await dockerRemove(newContainerId);
          return c.json({
            error: 'Container health check failed',
            details: `Health check at ${healthPath} did not pass within ${HEALTH_TIMEOUT_MS / 1000}s`,
          }, 503);
        }

        resolvedEndpoint = { kind: 'http-url', base_url: `http://${cName}:${exposedPort}` };
        await appendServiceLog(payload.space_id, routeRef, `DEPLOYED container ${newContainerId.slice(0, 12)} → ${resolvedEndpoint.base_url}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await appendServiceLog(payload.space_id, routeRef, `DEPLOY_ERROR ${errMsg}`);
        // Clean up partially created container
        if (newContainerId) {
          try {
            await dockerStop(newContainerId);
            await dockerRemove(newContainerId);
          } catch { /* best effort */ }
        }
        return c.json({
          error: 'Container deployment failed',
          details: errMsg.slice(0, 500),
        }, 500);
      }
    }

    const record: OciServiceRecord = {
      space_id: payload.space_id,
      route_ref: routeRef,
      deployment_id: payload.deployment_id,
      artifact_ref: payload.artifact_ref,
      endpoint: payload.target.endpoint,
      image_ref: imageRef,
      exposed_port: exposedPort,
      health_path: healthPath,
      container_id: newContainerId,
      resolved_endpoint: resolvedEndpoint,
      compatibility_date: runtime.compatibility_date ?? null,
      compatibility_flags: runtime.compatibility_flags ?? [],
      limits: runtime.limits ?? null,
      status: imageRef ? 'deployed' : 'routing-only',
      health_status: resolvedEndpoint ? 'healthy' : 'unknown',
      last_health_at: resolvedEndpoint ? now : null,
      last_error: null,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    };

    state.services[key] = record;
    await saveState(state);
    await appendServiceLog(payload.space_id, routeRef, `DEPLOY ${JSON.stringify({
      deployment_id: payload.deployment_id,
      artifact_ref: payload.artifact_ref,
      target: payload.target,
      runtime,
    })}`);

    return c.json({
      ok: true,
      service: record,
      resolved_endpoint: resolvedEndpoint,
      logs_ref: logPathFor(payload.space_id, routeRef),
    });
  });

  app.get('/services/:routeRef', async (c) => {
    const query = serviceActionSchema.safeParse({
      space_id: c.req.query('space_id'),
    });
    if (!query.success) {
      return c.json({ error: 'space_id is required' }, 400);
    }
    const routeRef = c.req.param('routeRef');
    const key = serviceKey(query.data.space_id, routeRef);
    const state = await loadState();
    const record = state.services[key];
    if (!record) {
      return c.json({ error: 'Service not found' }, 404);
    }
    return c.json({ service: record });
  });

  app.post('/services/:routeRef/remove', async (c) => {
    const query = serviceActionSchema.safeParse({
      space_id: c.req.query('space_id'),
    });
    if (!query.success) {
      return c.json({ error: 'space_id is required' }, 400);
    }
    const routeRef = c.req.param('routeRef');
    const key = serviceKey(query.data.space_id, routeRef);
    const state = await loadState();
    const record = state.services[key];
    if (!record) {
      return c.json({ error: 'Service not found' }, 404);
    }

    // Stop and remove the Docker container if present
    if (record.container_id) {
      await stopAndRemoveContainer(record, query.data.space_id, routeRef);
    }

    const updated: OciServiceRecord = {
      ...record,
      status: 'removed',
      container_id: null,
      resolved_endpoint: null,
      updated_at: new Date().toISOString(),
    };
    state.services[key] = updated;
    await saveState(state);
    await appendServiceLog(query.data.space_id, routeRef, 'REMOVE');
    return c.json({ ok: true, service: updated });
  });

  app.get('/services/:routeRef/logs', async (c) => {
    const query = serviceActionSchema.safeParse({
      space_id: c.req.query('space_id'),
    });
    if (!query.success) {
      return c.json({ error: 'space_id is required' }, 400);
    }
    const tail = Number.parseInt(c.req.query('tail') ?? '100', 10);
    const tailCount = Number.isFinite(tail) && tail > 0 ? tail : 100;
    const routeRef = c.req.param('routeRef');
    const key = serviceKey(query.data.space_id, routeRef);
    const state = await loadState();
    const record = state.services[key];
    if (!record) {
      return c.json({ error: 'Service not found' }, 404);
    }

    // Fetch Docker container logs if container is running
    let containerLogText = '';
    if (record.container_id && record.status === 'deployed') {
      try {
        containerLogText = await dockerLogs(record.container_id, tailCount);
      } catch {
        // Container may not be running
      }
    }

    // Also fetch file-based orchestrator logs
    let fileLogText = '';
    try {
      const body = await readFile(logPathFor(query.data.space_id, routeRef), 'utf8');
      fileLogText = tailLines(body, tailCount);
    } catch {
      // No file logs
    }

    // Combine: orchestrator events + container stdout/stderr
    const combined = fileLogText + (containerLogText ? `--- container logs ---\n${containerLogText}` : '');

    return new Response(combined || '', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  });

  // Reverse proxy to active container
  app.all('/proxy/:spaceId/:routeRef/*', async (c) => {
    const spaceId = c.req.param('spaceId');
    const routeRef = c.req.param('routeRef');
    const key = serviceKey(spaceId, routeRef);
    const state = await loadState();
    const record = state.services[key];

    if (!record || record.status !== 'deployed' || !record.resolved_endpoint) {
      return c.json({ error: 'No active container for this service' }, 503);
    }

    const baseUrl = record.resolved_endpoint.base_url;
    const proxyPrefix = `/proxy/${spaceId}/${routeRef}`;
    const remainingPath = c.req.path.slice(proxyPrefix.length) || '/';
    const targetUrl = new URL(remainingPath, baseUrl);
    targetUrl.search = new URL(c.req.url).search;

    const headers = new Headers(c.req.raw.headers);
    headers.delete('host');

    try {
      const upstream = await fetch(targetUrl.toString(), {
        method: c.req.method,
        headers,
        body: c.req.method !== 'GET' && c.req.method !== 'HEAD' ? c.req.raw.body : undefined,
        redirect: 'manual',
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: upstream.headers,
      });
    } catch (err) {
      return c.json({
        error: 'Proxy request failed',
        details: err instanceof Error ? err.message : String(err),
      }, 502);
    }
  });

  return app;
}

export async function createLocalOciOrchestratorFetchForTests(): Promise<(request: Request) => Promise<Response>> {
  const app = createLocalOciOrchestratorApp();
  return (request: Request) => Promise.resolve(app.fetch(request));
}

export async function startLocalOciOrchestratorServer(): Promise<void> {
  const port = resolvePort();
  const app = createLocalOciOrchestratorApp();
  await serveNodeFetch({
    fetch: app.fetch.bind(app),
    port,
    onListen: () => {
      logInfo('oci-orchestrator local runtime started', {
        module: 'local_oci_orchestrator',
        port,
        dataDir: resolveDataDir(),
      });
    },
  });
}
