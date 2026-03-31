import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { logError, logInfo, logWarn } from '../shared/utils/logger.ts';
import { serveNodeFetch } from './fetch-server.ts';
import type { ContainerBackend } from './container-backend.ts';
import { CloudRunContainerBackend } from './cloud-run-container-backend.ts';
import { DockerContainerBackend } from './docker-container-backend.ts';
import { EcsContainerBackend } from './ecs-container-backend.ts';
import { K8sContainerBackend } from './k8s-container-backend.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

type OciServiceStatus = 'deployed' | 'removed' | 'routing-only';

// Derived from deploySchema.target.endpoint
type DeployPayload = z.infer<typeof deploySchema>;
type OciServiceEndpoint = DeployPayload['target']['endpoint'];

type OciServiceRecord = {
  space_id: string;
  route_ref: string;
  deployment_id: string;
  artifact_ref: string;
  provider_name: 'oci' | 'ecs' | 'cloud-run' | 'k8s';
  provider_config: Record<string, unknown> | null;
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

type OciProviderName = OciServiceRecord['provider_name'];

export type OciOrchestratorBackendResolverInput = {
  providerName: OciProviderName;
  providerConfig: Record<string, unknown> | null;
};

export type OciOrchestratorBackendResolver = (
  input: OciOrchestratorBackendResolverInput,
) => ContainerBackend;

const DOCKER_NETWORK = Deno.env.get('TAKOS_DOCKER_NETWORK') || 'takos-containers';
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_INTERVAL_MS = 1_000;

// ─── Health-check polling (works for both Docker/k8s host:port and provider URLs) ───

async function pollHealthCheck(
  host: string,
  port: number,
  healthPath: string,
  timeoutMs: number,
): Promise<boolean> {
  if (Deno.env.get('TAKOS_SKIP_OCI_HEALTH_CHECK') === '1') {
    return true;
  }

  const normalizedPath = healthPath.startsWith('/') ? healthPath : `/${healthPath}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const result = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: host, port, path: normalizedPath, method: 'GET', timeout: 5000 },
          (res) => {
            res.on('data', (chunk) => {
              void chunk;
            });
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

async function pollHealthCheckUrl(
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  if (Deno.env.get('TAKOS_SKIP_OCI_HEALTH_CHECK') === '1') {
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status >= 200 && response.status < 400) {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

function containerName(spaceId: string, routeRef: string): string {
  // Sanitize for container / pod naming
  return `takos-${spaceId}-${routeRef}`.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 128);
}

const deploySchema = z.object({
  deployment_id: z.string().min(1),
  space_id: z.string().min(1),
  artifact_ref: z.string().min(1),
  provider: z.object({
    name: z.enum(['oci', 'ecs', 'cloud-run', 'k8s']),
    config: z.record(z.string(), z.unknown()).optional(),
  }).strict().optional(),
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
  const explicit = Deno.env.get('OCI_ORCHESTRATOR_DATA_DIR')?.trim();
  if (explicit) return path.resolve(explicit);
  const localDir = Deno.env.get('TAKOS_LOCAL_DATA_DIR')?.trim();
  if (localDir) {
    return path.resolve(localDir, 'oci-orchestrator');
  }
  return path.resolve(process.cwd(), '.takos-local-oci-orchestrator');
}

function resolvePort(): number {
  const parsed = Number.parseInt(Deno.env.get('PORT') ?? Deno.env.get('OCI_ORCHESTRATOR_PORT') ?? '', 10);
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
  const token = Deno.env.get('OCI_ORCHESTRATOR_TOKEN')?.trim();
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

function readProviderConfigString(
  providerConfig: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const value = providerConfig?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readProviderConfigBoolean(
  providerConfig: Record<string, unknown> | null,
  key: string,
): boolean | undefined {
  const value = providerConfig?.[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return undefined;
}

function readProviderConfigNumber(
  providerConfig: Record<string, unknown> | null,
  key: string,
): number | undefined {
  const value = providerConfig?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readProviderConfigStringArray(
  providerConfig: Record<string, unknown> | null,
  key: string,
): string[] | undefined {
  const value = providerConfig?.[key];
  if (Array.isArray(value)) {
    const entries = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }
  if (typeof value === 'string') {
    const entries = value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }
  return undefined;
}

export function createDefaultOciOrchestratorBackendResolver(options?: {
  fallbackBackend?: ContainerBackend;
}): OciOrchestratorBackendResolver {
  const fallbackBackend = options?.fallbackBackend ?? new DockerContainerBackend();
  const providerBackends = new Map<string, ContainerBackend>();

  return ({ providerName, providerConfig }) => {
    if (providerName === 'oci') {
      return fallbackBackend;
    }

    const cacheKey = `${providerName}:${JSON.stringify(providerConfig ?? {})}`;
    const existing = providerBackends.get(cacheKey);
    if (existing) {
      return existing;
    }

    let backend: ContainerBackend;
    switch (providerName) {
      case 'k8s': {
        backend = new K8sContainerBackend(readProviderConfigString(providerConfig, 'namespace'));
        break;
      }
      case 'cloud-run': {
        const projectId = readProviderConfigString(providerConfig, 'projectId');
        const region = readProviderConfigString(providerConfig, 'region');
        if (!projectId || !region) {
          return fallbackBackend;
        }
        backend = new CloudRunContainerBackend({
          projectId,
          region,
          serviceId: readProviderConfigString(providerConfig, 'serviceId'),
          serviceAccount: readProviderConfigString(providerConfig, 'serviceAccount'),
          ingress: readProviderConfigString(providerConfig, 'ingress'),
          allowUnauthenticated: readProviderConfigBoolean(providerConfig, 'allowUnauthenticated'),
          baseUrl: readProviderConfigString(providerConfig, 'baseUrl'),
          deleteOnRemove: readProviderConfigBoolean(providerConfig, 'deleteOnRemove'),
        });
        break;
      }
      case 'ecs': {
        const region = readProviderConfigString(providerConfig, 'region');
        const clusterArn = readProviderConfigString(providerConfig, 'clusterArn');
        const taskDefinitionFamily = readProviderConfigString(providerConfig, 'taskDefinitionFamily');
        if (!region || !clusterArn || !taskDefinitionFamily) {
          return fallbackBackend;
        }
        backend = new EcsContainerBackend({
          region,
          clusterArn,
          taskDefinitionFamily,
          serviceArn: readProviderConfigString(providerConfig, 'serviceArn'),
          serviceName: readProviderConfigString(providerConfig, 'serviceName'),
          containerName: readProviderConfigString(providerConfig, 'containerName'),
          subnetIds: readProviderConfigStringArray(providerConfig, 'subnetIds'),
          securityGroupIds: readProviderConfigStringArray(providerConfig, 'securityGroupIds'),
          assignPublicIp: readProviderConfigBoolean(providerConfig, 'assignPublicIp'),
          launchType: readProviderConfigString(providerConfig, 'launchType'),
          desiredCount: readProviderConfigNumber(providerConfig, 'desiredCount'),
          baseUrl: readProviderConfigString(providerConfig, 'baseUrl'),
          healthUrl: readProviderConfigString(providerConfig, 'healthUrl'),
        });
        break;
      }
      default:
        return fallbackBackend;
    }

    providerBackends.set(cacheKey, backend);
    return backend;
  };
}

// ─── Options for app creation ───

export interface OciOrchestratorAppOptions {
  /** Fixed backend to use for every provider. Preserved for tests and explicit overrides. */
  backend?: ContainerBackend;
  /** Resolve a backend from the requested provider. Defaults to a provider-aware resolver. */
  backendResolver?: OciOrchestratorBackendResolver;
}

// ─── App factory ───

export function createLocalOciOrchestratorApp(options?: OciOrchestratorAppOptions): Hono {
  const backendResolver = options?.backendResolver
    ?? (options?.backend
      ? (() => options.backend!)
      : createDefaultOciOrchestratorBackendResolver());
  const app = new Hono();

  async function stopAndRemoveContainer(record: OciServiceRecord, spaceId: string, routeRef: string): Promise<void> {
    if (!record.container_id) return;
    const backend = backendResolver({
      providerName: record.provider_name,
      providerConfig: record.provider_config,
    });
    try {
      await backend.stop(record.container_id);
      await backend.remove(record.container_id);
      await appendServiceLog(spaceId, routeRef, `CONTAINER_REMOVED ${record.container_id}`);
    } catch (err) {
      logError(`Failed to stop/remove container ${record.container_id}`, err, { module: 'oci-orchestrator' });
    }
  }

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
    const providerName = payload.provider?.name ?? 'oci';
    const providerConfig = payload.provider?.config ?? null;
    const runtime: NonNullable<DeployPayload['runtime']> = payload.runtime ?? { compatibility_flags: [] };
    const backend = backendResolver({ providerName, providerConfig });

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
          await backend.stop(cName);
          await backend.remove(cName);
        } catch (err) { logWarn('stop/remove pre-existing container by name failed (non-critical)', { module: 'oci-orchestrator', error: err instanceof Error ? err.message : String(err) }); }

        await appendServiceLog(payload.space_id, routeRef, `PULLING ${imageRef}`);
        await backend.pullImage(imageRef);

        await appendServiceLog(payload.space_id, routeRef, `CREATING container ${cName}`);
        const createResult = await backend.createAndStart({
          imageRef,
          name: cName,
          exposedPort,
          network: DOCKER_NETWORK,
          healthPath,
          requestedEndpoint: payload.target.endpoint,
          labels: {
            'takos.space-id': payload.space_id,
            'takos.route-ref': routeRef,
            'takos.deployment-id': payload.deployment_id,
          },
        });
        newContainerId = createResult.containerId;

        await appendServiceLog(payload.space_id, routeRef, `STARTED container ${newContainerId.slice(0, 12)}`);

        let healthy = false;
        if (createResult.healthCheckUrl) {
          await appendServiceLog(payload.space_id, routeRef, `HEALTH_CHECK polling ${createResult.healthCheckUrl}`);
          healthy = await pollHealthCheckUrl(createResult.healthCheckUrl, HEALTH_TIMEOUT_MS);
        } else {
          // Determine the hostname for health-checking and endpoint resolution.
          // For Docker, we use the container name (DNS on the Docker network).
          // For k8s (or any backend that provides a pod IP), we use the IP.
          const containerIp = await backend.getContainerIp(newContainerId);
          const healthHost = containerIp ?? cName;
          await appendServiceLog(payload.space_id, routeRef, `HEALTH_CHECK polling ${healthHost}:${exposedPort}${healthPath}`);
          healthy = await pollHealthCheck(healthHost, exposedPort, healthPath, HEALTH_TIMEOUT_MS);
          resolvedEndpoint = { kind: 'http-url', base_url: `http://${healthHost}:${exposedPort}` };
        }

        if (!healthy) {
          await appendServiceLog(payload.space_id, routeRef, `HEALTH_CHECK failed, removing container`);
          await backend.stop(newContainerId);
          await backend.remove(newContainerId);
          return c.json({
            error: 'Container health check failed',
            details: `Health check at ${healthPath} did not pass within ${HEALTH_TIMEOUT_MS / 1000}s`,
          }, 503);
        }

        resolvedEndpoint = createResult.resolvedEndpoint ?? resolvedEndpoint;
        if (!resolvedEndpoint) {
          throw new Error('Container backend did not provide a resolved endpoint');
        }
        await appendServiceLog(payload.space_id, routeRef, `DEPLOYED container ${newContainerId.slice(0, 12)} → ${resolvedEndpoint.base_url}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await appendServiceLog(payload.space_id, routeRef, `DEPLOY_ERROR ${errMsg}`);
        // Clean up partially created container
        if (newContainerId) {
          try {
            await backend.stop(newContainerId);
            await backend.remove(newContainerId);
          } catch (err) { logWarn('cleanup of partially created container failed (non-critical)', { module: 'oci-orchestrator', error: err instanceof Error ? err.message : String(err) }); }
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
      provider_name: providerName,
      provider_config: providerConfig,
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
      provider: payload.provider ?? { name: 'oci' },
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

    // Stop and remove the container if present
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

    // Fetch container logs if container is running
    let containerLogText = '';
    if (record.container_id && record.status === 'deployed') {
      const backend = backendResolver({
        providerName: record.provider_name,
        providerConfig: record.provider_config,
      });
      try {
        containerLogText = await backend.getLogs(record.container_id, tailCount);
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

export async function createLocalOciOrchestratorFetchForTests(
  options?: OciOrchestratorAppOptions,
): Promise<(request: Request) => Promise<Response>> {
  const app = createLocalOciOrchestratorApp(options);
  return (request: Request) => Promise.resolve(app.fetch(request));
}

export async function startLocalOciOrchestratorServer(
  options?: OciOrchestratorAppOptions,
): Promise<void> {
  const port = resolvePort();
  const app = createLocalOciOrchestratorApp(options);
  await serveNodeFetch({
    fetch: app.fetch.bind(app),
    port,
    onListen: () => {
      logInfo('oci-orchestrator local runtime started', {
        module: 'local_oci_orchestrator',
        port,
        dataDir: resolveDataDir(),
        backend: options?.backend
          ? (options.backend.constructor?.name ?? 'custom-backend')
          : options?.backendResolver
            ? 'custom-resolver'
            : 'provider-aware-default',
      });
    },
  });
}

if (await isDirectEntrypoint(import.meta.url)) {
  startLocalOciOrchestratorServer().catch(logEntrypointError);
}
