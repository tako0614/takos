import { Hono } from 'hono';
import type { Env } from '@/types';

import { assertEquals } from 'jsr:@std/assert';
import { assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  getDb: ((..._args: any[]) => undefined) as any,
  planManifest: ((..._args: any[]) => undefined) as any,
  applyManifest: ((..._args: any[]) => undefined) as any,
  getGroupState: ((..._args: any[]) => undefined) as any,
  parseAppManifestYaml: ((..._args: any[]) => undefined) as any,
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
});

// [Deno] vi.mock removed - manually stub imports from 'takos-common/errors'
// [Deno] vi.mock removed - manually stub imports from '@/services/source/app-manifest-parser'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/group-managed-desired-state'
// [Deno] vi.mock removed - manually stub imports from '@/services/deployment/apply-engine'
// [Deno] vi.mock removed - manually stub imports from '@/db'
// [Deno] vi.mock removed - manually stub imports from '@/routes/route-auth'
import groupsRouter from '@/routes/groups';


  Deno.test('groups routes - does not expose the legacy /entities inventory endpoints', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    mocks.getGroupState = (async () => null) as any;
    mocks.planManifest = (async () => ({
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    })) as any;
    mocks.applyManifest = (async () => ({
      groupId: 'group-1',
      applied: [],
      skipped: [],
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    })) as any;
    mocks.getDb = (() => ({
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
    })) as any;
  const app = new Hono<{ Bindings: Env }>();
    app.route('/', groupsRouter);

    const res = await app.request('/spaces/ws1/groups/group-1/entities', { method: 'GET' });

    assertEquals(res.status, 404);
})
  Deno.test('groups routes - updates provider/env on the group-id plan route before planning', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    mocks.getGroupState = (async () => null) as any;
    mocks.planManifest = (async () => ({
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    })) as any;
    mocks.applyManifest = (async () => ({
      groupId: 'group-1',
      applied: [],
      skipped: [],
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    })) as any;
    mocks.getDb = (() => ({
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
    })) as any;
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

    assertEquals(res.status, 200);
    assertEquals(mocks.updateCalls.length, 1);
    assertEquals(mocks.updateCalls[0], ({
      provider: 'aws',
      env: 'production',
    }));
    assertSpyCallArgs(mocks.planManifest, 0, [expect.anything(), 'group-1', manifest, {
      envName: 'production',
    }]);
})
  Deno.test('groups routes - updates provider/env on the group-id apply route before apply', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
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
    mocks.getGroupState = (async () => null) as any;
    mocks.planManifest = (async () => ({
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    })) as any;
    mocks.applyManifest = (async () => ({
      groupId: 'group-1',
      applied: [],
      skipped: [],
      diff: { entries: [], hasChanges: false, summary: { create: 0, update: 0, delete: 0, unchanged: 0 } },
      translationReport: { provider: 'aws', supported: true, requirements: [], resources: [], workloads: [], routes: [], unsupported: [] },
    })) as any;
    mocks.getDb = (() => ({
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
    })) as any;
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

    assertEquals(res.status, 200);
    assertEquals(mocks.updateCalls.length, 1);
    assertEquals(mocks.updateCalls[0], ({
      provider: 'k8s',
      env: 'preview',
    }));
    assertSpyCallArgs(mocks.applyManifest, 0, [expect.anything(), 'group-1', manifest, ({
      envName: 'preview',
    })]);
})