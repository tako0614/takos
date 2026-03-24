import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { z } from 'zod';
import { logInfo } from '../shared/utils/logger.ts';
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
    const exposedPort = payload.target.artifact?.exposed_port ?? null;
    const runtime: {
      compatibility_date?: string | null;
      compatibility_flags?: string[];
      limits?: {
        cpu_ms?: number;
        subrequests?: number;
      } | null;
    } = payload.runtime ?? {};
    const record: OciServiceRecord = {
      space_id: payload.space_id,
      route_ref: routeRef,
      deployment_id: payload.deployment_id,
      artifact_ref: payload.artifact_ref,
      endpoint: payload.target.endpoint,
      image_ref: imageRef,
      exposed_port: exposedPort,
      compatibility_date: runtime.compatibility_date ?? null,
      compatibility_flags: runtime.compatibility_flags ?? [],
      limits: runtime.limits ?? null,
      status: imageRef ? 'deployed' : 'routing-only',
      health_status: 'unknown',
      last_health_at: null,
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
      log_path: logPathFor(payload.space_id, routeRef),
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
    const updated: OciServiceRecord = {
      ...record,
      status: 'removed',
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
    const routeRef = c.req.param('routeRef');
    const key = serviceKey(query.data.space_id, routeRef);
    const state = await loadState();
    if (!state.services[key]) {
      return c.json({ error: 'Service not found' }, 404);
    }
    try {
      const body = await readFile(logPathFor(query.data.space_id, routeRef), 'utf8');
      return new Response(tailLines(body, Number.isFinite(tail) && tail > 0 ? tail : 100), {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    } catch {
      return new Response('', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
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
