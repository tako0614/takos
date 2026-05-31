import assert, { deepStrictEqual } from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'bun:test';
import app from './index.ts';
import { TAKOS_PUBLIC_API_PATHS } from 'takos-api-contract';
import { TAKOSUMI_INTERNAL_PATHS } from 'takosumi-contract-v2/internal/api';
import { createSqliteSqlDatabase, type ServerSqlDatabase } from '../../worker/local-platform/persistent-d1.ts';
import type { ControlPlatform } from '../../worker/platform/platform-config.ts';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from '../../worker/application/services/identity/session.ts';
import type { DurableNamespaceBinding, DurableObjectStubBinding } from '../../worker/shared/types/bindings.ts';
import type { Env } from '../../worker/shared/types/index.ts';

test('src/routes/public gateway contract mounts control routes in-process', async () => {
  const tempDir = await makeTempDir('gateway-contract-test-');
  const db = await createSqliteSqlDatabase(
    `${tempDir}/gateway-contract.sqlite`,
    fileURLToPath(new URL('../../../db/migrations-control/migrations/', import.meta.url)),
  );
  const sessionId = 'session_contract_1234567890';
  const sessions = new Map<string, StoredSession>([
    [sessionId, createStoredSession(sessionId, 'acct_contract')],
  ]);
  await seedAccount(db);

  const controlEnv = createControlEnv(db, createSessionStore(sessions));
  const takosumiCalls: RecordedRequest[] = [];
  const takosumiServer = serveRecordedJson(takosumiCalls, {
    spaces: [],
  });
  const restoreEnv = configureGatewayEnv({
    takosumiUrl: takosumiServer.origin,
  });

  try {
    const cookie = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const spaces = await app.request(
      TAKOS_PUBLIC_API_PATHS.spaces,
      {
        headers: {
          cookie,
          'x-takos-account-id': 'client-controlled',
        },
      },
      controlEnv,
    );
    const spacesBody = await spaces.json() as {
      spaces: unknown[];
    };
    deepStrictEqual(spaces.status, 200);
    deepStrictEqual(spacesBody.spaces, []);
    deepStrictEqual(takosumiCalls.length, 1);
    deepStrictEqual(
      new URL(takosumiCalls[0].url).pathname,
      TAKOSUMI_INTERNAL_PATHS.spaces,
    );
    const actor = actorFromSignedHeaders(takosumiCalls[0].headers);
    deepStrictEqual(actor.actorAccountId, 'acct_contract');
    deepStrictEqual(actor.spaceId, undefined);

    const me = await app.request('/api/me', {
      headers: {
        cookie,
        'x-takos-account-id': 'client-controlled',
      },
    }, controlEnv);
    const meBody = await me.json() as {
      email: string;
      username: string;
      setup_completed: boolean;
    };
    deepStrictEqual(me.status, 200);
    deepStrictEqual(meBody.email, 'tako@example.com');
    deepStrictEqual(meBody.username, 'tako');
    deepStrictEqual(meBody.setup_completed, true);

    const authMe = await app.request('/api/auth/me', {
      headers: { cookie },
    }, controlEnv);
    const authMeBody = await authMe.json() as {
      user: { email: string; username: string };
    };
    deepStrictEqual(authMe.status, 200);
    deepStrictEqual(authMeBody.user.email, 'tako@example.com');
    deepStrictEqual(authMeBody.user.username, 'tako');

    const profile = await app.request('/api/users/tako', {}, controlEnv);
    const profileBody = await profile.json() as {
      user: { username: string; public_repo_count: number };
    };
    deepStrictEqual(profile.status, 200);
    deepStrictEqual(profileBody.user.username, 'tako');
    deepStrictEqual(profileBody.user.public_repo_count, 0);

    const billing = await app.request('/api/billing', {
      headers: { cookie },
    }, controlEnv);
    deepStrictEqual(billing.status, 410);
  } finally {
    restoreEnv();
    await takosumiServer.close();
    closeDb(db);
    await rm(tempDir, { recursive: true, force: true });
  }
});

import { test } from 'bun:test';

type StoredSession = {
  id: string;
  user_id: string;
  expires_at: number;
  created_at: number;
  last_rotated_at: number;
};

type RecordedRequest = {
  url: string;
  method: string;
  headers: Headers;
  bodyText: string;
};

function createStoredSession(id: string, userId: string): StoredSession {
  const now = Date.now();
  return {
    id,
    user_id: userId,
    expires_at: now + SESSION_TTL_MS,
    created_at: now,
    last_rotated_at: now,
  };
}

async function seedAccount(db: ServerSqlDatabase): Promise<void> {
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO accounts (
      id, type, status, name, slug, email, trust_tier, setup_completed,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    'acct_contract',
    'user',
    'active',
    'Tako Contract',
    'tako',
    'tako@example.com',
    'normal',
    1,
    now,
    now,
  ).run();

  await db.prepare(
    `INSERT INTO auth_identities (
      id, user_id, provider, provider_sub, email_snapshot, email_kind,
      linked_at, last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    'ident_contract',
    'acct_contract',
    'google',
    'google-contract',
    'tako@example.com',
    'google_authoritative',
    now,
    now,
  ).run();
}

function createControlEnv(
  db: ServerSqlDatabase,
  sessionStore: DurableNamespaceBinding,
): Env {
  const env = {
    DB: db,
    ENVIRONMENT: 'development',
    TAKOS_INTERNAL_API_SECRET: 'gateway-contract-secret',
  } as unknown as Env & { PLATFORM?: ControlPlatform<Env> };

  const platform: ControlPlatform<Env> = {
    source: 'node',
    bindings: env,
    config: {
      adminDomain: 'takos.test',
      tenantBaseDomain: 'tenant.takos.test',
      environment: 'development',
    },
    services: {
      sql: { binding: db },
      routing: {
        resolveHostname() {
          return Promise.reject(
            new Error('routing is not used in this test'),
          );
        },
        selectDeploymentTarget() {
          return null;
        },
        selectRouteRef() {
          return null;
        },
      },
      queues: {},
      objects: {},
      notifications: { sessionStore },
      locks: {},
      hosts: {},
      ai: {},
      assets: {},
      documents: {},
    },
  };
  env.PLATFORM = platform;
  return env;
}

function createSessionStore(
  sessions: Map<string, StoredSession>,
): DurableNamespaceBinding {
  const stub: DurableObjectStubBinding = {
    async fetch(input, init) {
      const request = input instanceof Request ? input.clone() : new Request(input, init);
      const path = new URL(request.url).pathname;

      if (path === '/session/create' && request.method === 'POST') {
        const payload = await request.json() as { session?: StoredSession };
        if (!payload.session) {
          return Response.json({ error: 'missing session' }, { status: 400 });
        }
        sessions.set(payload.session.id, payload.session);
        return Response.json({ ok: true });
      }

      if (path === '/session/get' && request.method === 'POST') {
        const payload = await request.json() as { sessionId?: string };
        return Response.json({
          session: payload.sessionId ? sessions.get(payload.sessionId) ?? null : null,
        });
      }

      if (path === '/session/delete' && request.method === 'POST') {
        const payload = await request.json() as { sessionId?: string };
        if (payload.sessionId) sessions.delete(payload.sessionId);
        return Response.json({ ok: true });
      }

      return Response.json({ error: 'not found' }, { status: 404 });
    },
  };

  return {
    idFromName(name: string) {
      return name;
    },
    get(_id: unknown) {
      return stub;
    },
  } as DurableNamespaceBinding;
}

function serveRecordedJson(
  calls: RecordedRequest[],
  responseBody: unknown,
): TestServer {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      calls.push({
        url: request.url,
        method: request.method,
        headers: new Headers(request.headers),
        bodyText: await request.text(),
      });
      return Response.json(responseBody);
    },
  });
  return serverInfo(server);
}

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

function serverInfo(server: Bun.Server): TestServer {
  const { hostname, port } = server;
  return {
    origin: `http://${hostname}:${port}`,
    close: () => {
      server.stop();
      return Promise.resolve();
    },
  };
}

function configureGatewayEnv(input: { takosumiUrl: string }): () => void {
  const values = {
    TAKOS_INTERNAL_API_SECRET: 'gateway-contract-secret',
    TAKOS_INTERNAL_SERVICE_SECRET: 'gateway-contract-service-secret',
    TAKOSUMI_INTERNAL_URL: input.takosumiUrl,
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function actorFromSignedHeaders(
  headers: Headers,
): Record<string, unknown> {
  const actorHeader = headers.get('x-takos-actor-context') ??
    headers.get('x-takosumi-actor-context');
  assert(actorHeader);
  return JSON.parse(atob(actorHeader)) as Record<string, unknown>;
}

function closeDb(db: ServerSqlDatabase): void {
  (db as ServerSqlDatabase & { close?: () => void }).close?.();
}

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}`));
}
