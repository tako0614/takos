import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '@/types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  planManifest: vi.fn(),
  applyManifest: vi.fn(),
  getGroupState: vi.fn(),
  parseAppManifestYaml: vi.fn(),
  groupRow: {
    id: 'group-1',
    spaceId: 'ws1',
    name: 'demo-group',
    appVersion: '1.0.0',
    provider: 'cloudflare',
    env: 'staging',
    desiredSpecJson: null,
    providerStateJson: '{}',
    reconcileStatus: 'idle',
    lastAppliedAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  } as {
    id: string;
    spaceId: string;
    name: string;
    appVersion: string | null;
    provider: string | null;
    env: string | null;
    desiredSpecJson: string | null;
    providerStateJson: string | null;
    reconcileStatus: string;
    lastAppliedAt: string | null;
    createdAt: string;
    updatedAt: string;
  },
  updateCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('takos-common/errors', () => ({
  BadRequestError: class BadRequestError extends Error {},
  NotFoundError: class NotFoundError extends Error {},
}));

vi.mock('@/services/source/app-manifest-parser', () => ({
  parseAppManifestYaml: mocks.parseAppManifestYaml,
}));

vi.mock('@/services/deployment/group-managed-desired-state', () => ({
  syncGroupManagedDesiredState: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/services/deployment/apply-engine', () => ({
  getGroupState: mocks.getGroupState,
  planManifest: mocks.planManifest,
  applyManifest: mocks.applyManifest,
}));

vi.mock('@/db', () => ({
  getDb: mocks.getDb,
  groups: {},
  resources: {},
  services: {},
  deployments: {},
}));

vi.mock('@/routes/route-auth', () => ({
  spaceAccess: () => async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set('access', { space: { id: 'ws1' } });
    await next();
  },
}));

import groupsRouter from '@/routes/groups';

describe('groups routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.groupRow = {
      id: 'group-1',
      spaceId: 'ws1',
      name: 'demo-group',
      appVersion: '1.0.0',
      provider: 'cloudflare',
      env: 'staging',
      desiredSpecJson: null,
      providerStateJson: '{}',
      reconcileStatus: 'idle',
      lastAppliedAt: null,
      createdAt: '2026-03-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    };
    mocks.updateCalls = [];
    mocks.getGroupState.mockResolvedValue(null);
    mocks.planManifest.mockResolvedValue({
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    });
    mocks.applyManifest.mockResolvedValue({
      groupId: 'group-1',
      applied: [],
      skipped: [],
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    });
    mocks.getDb.mockReturnValue({
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  get: async () => mocks.groupRow,
                  all: async () => [],
                };
              },
            };
          },
        };
      },
      update() {
        return {
          set(payload: Record<string, unknown>) {
            mocks.updateCalls.push(payload);
            mocks.groupRow = {
              ...mocks.groupRow,
              ...payload,
            };
            return {
              where() {
                return {
                  run: async () => undefined,
                };
              },
            };
          },
        };
      },
    });
  });

  it('does not expose the legacy /entities inventory endpoints', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/', groupsRouter);

    const res = await app.request('/spaces/ws1/groups/group-1/entities', { method: 'GET' });

    expect(res.status).toBe(404);
  });

  it('updates provider/env on the group-id plan route before planning', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/', groupsRouter);
    const manifest = { metadata: { name: 'demo-group' }, spec: { version: '1.0.0' } };

    const res = await app.fetch(
      new Request('http://localhost/spaces/ws1/groups/group-1/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'aws',
          env: 'production',
          manifest,
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]).toEqual(expect.objectContaining({
      provider: 'aws',
      env: 'production',
    }));
    expect(mocks.planManifest).toHaveBeenCalledWith(expect.anything(), 'group-1', manifest, {
      envName: 'production',
    });
  });

  it('updates provider/env on the group-id apply route before apply', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.route('/', groupsRouter);
    const manifest = { metadata: { name: 'demo-group' }, spec: { version: '1.0.0' } };

    const res = await app.fetch(
      new Request('http://localhost/spaces/ws1/groups/group-1/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'k8s',
          env: 'preview',
          manifest,
        }),
      }),
      { DB: {} } as Env,
      {} as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(mocks.updateCalls).toHaveLength(1);
    expect(mocks.updateCalls[0]).toEqual(expect.objectContaining({
      provider: 'k8s',
      env: 'preview',
    }));
    expect(mocks.applyManifest).toHaveBeenCalledWith(expect.anything(), 'group-1', manifest, expect.objectContaining({
      envName: 'preview',
    }));
  });
});
