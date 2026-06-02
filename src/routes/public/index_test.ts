import { deepStrictEqual, ok } from 'node:assert/strict';
import { test } from 'bun:test';
import app from './index.ts';
import { isGitSmartHttpPath } from './shared/api/forwarding.ts';
import { exploreCatalogRouteDeps } from './shared/explore/catalog.ts';
import { exploreDiscoveryRouteDeps } from './shared/explore/discovery.ts';
import { explorePackageRouteDeps } from './shared/explore/packages.ts';
import { TAKOS_PUBLIC_API_PATHS } from 'takos-api-contract';
import type { SqlDatabaseBinding } from 'takos-api-contract/shared/types';
import { TAKOSUMI_INTERNAL_PATHS } from 'takosumi-contract-v2/internal/api';
import { authDeps } from '../../worker/server/middleware/auth.ts';
import type { User } from '../../worker/shared/types/index.ts';

const retiredDeploymentRouteBuilders = {
  deployment: (deploymentId: string): string => `/api/public/v1/deployments/${encodeURIComponent(deploymentId)}`,
  deploymentApply: (deploymentId: string): string =>
    `/api/public/v1/deployments/${encodeURIComponent(deploymentId)}/apply`,
  deploymentApprove: (deploymentId: string): string =>
    `/api/public/v1/deployments/${encodeURIComponent(deploymentId)}/approve`,
  deploymentObservations: (deploymentId: string): string =>
    `/api/public/v1/deployments/${encodeURIComponent(deploymentId)}/observations`,
  groupHead: (groupId: string): string => `/api/public/v1/groups/${encodeURIComponent(groupId)}/head`,
  groupRollback: (groupId: string): string => `/api/public/v1/groups/${encodeURIComponent(groupId)}/rollback`,
} as const;

test('isGitSmartHttpPath matches only structured Git Smart HTTP service paths', () => {
  // Real Git Smart HTTP endpoints (with and without the `/git` prefix).
  deepStrictEqual(isGitSmartHttpPath('/git/owner/repo.git/info/refs'), true);
  deepStrictEqual(isGitSmartHttpPath('/owner/repo.git/info/refs'), true);
  deepStrictEqual(
    isGitSmartHttpPath('/git/owner/repo.git/git-upload-pack'),
    true,
  );
  deepStrictEqual(
    isGitSmartHttpPath('/git/owner/repo.git/git-receive-pack'),
    true,
  );
  // A non-Git route whose segment merely ends in `.git` must NOT be classified
  // as a Git request (would otherwise be granted the larger Git body cap).
  deepStrictEqual(isGitSmartHttpPath('/api/threads/foo.git/bar'), false);
  deepStrictEqual(isGitSmartHttpPath('/api/explore/repos/foo.git'), false);
  // Bare repo path and unrelated `.git`-free paths are not Smart HTTP.
  deepStrictEqual(isGitSmartHttpPath('/git/owner/repo.git'), false);
  deepStrictEqual(isGitSmartHttpPath('/api/explore/catalog'), false);
});

test('public v3 deployment create is retired after authentication', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiFetch(calls, { unexpected: true }, 500);
  try {
    const response = await app.request(TAKOS_PUBLIC_API_PATHS.deployments, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: JSON.stringify({
        mode: 'apply',
        space_id: 'space_1',
        group: 'docs',
        source: { kind: 'git', url: 'https://example.test/app.git', ref: 'main' },
      }),
    });
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 410);
    deepStrictEqual(calls.length, 0);
    deepStrictEqual(body.error.code, 'GONE');
  } finally {
    restore();
  }
});

test('public v3 deployment create authenticates before disclosing backend retirement', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiFetch(calls, { unexpected: true }, 500);
  try {
    // No auth headers: an unauthenticated caller must NOT be able to probe
    // deployment backend configuration. Auth runs first -> 401.
    const response = await app.request(TAKOS_PUBLIC_API_PATHS.deployments, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'apply',
        space_id: 'space_1',
        group: 'docs',
        source: { kind: 'git', url: 'https://example.test/app.git', ref: 'main' },
      }),
    });
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 401);
    deepStrictEqual(body.error.code, 'UNAUTHORIZED');
  } finally {
    restore();
  }
});

test('public v3 deployment create remains retired for apply requests', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiFetch(calls, { unexpected: true }, 500);
  try {
    const response = await app.request(TAKOS_PUBLIC_API_PATHS.deployments, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: JSON.stringify({
        mode: 'apply',
        space_id: 'space_1',
        group: 'docs',
        source: { kind: 'git', url: 'https://example.test/app.git', ref: 'main' },
      }),
    });
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 410);
    deepStrictEqual(body.error.code, 'GONE');
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('public v3 deployment create rejects retired inline workflow deploys', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiFetch(calls, {
    deployment_id: 'dep_legacy',
    status: 'applied',
    conditions: [],
  }, 201);
  try {
    const response = await app.request(TAKOS_PUBLIC_API_PATHS.deployments, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: JSON.stringify({
        mode: 'apply',
        space_id: 'space_1',
        group: 'docs',
        source: {
          kind: 'inline',
          artifacts: [{
            compute: 'gateway',
            workflow: {
              path: '.takos/workflows/deploy.yml',
              job: 'bundle',
            },
            files: [{ path: 'dist/gateway.mjs', content: 'ZXhwb3J0' }],
          }],
        },
      }),
    });
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 400);
    deepStrictEqual(calls.length, 0);
    deepStrictEqual(body.error.code, 'INVALID_ARGUMENT');
    ok(body.error.message.includes('source.kind="inline"'));
    ok(body.error.message.includes('Deploy via Takosumi'));
    ok(body.error.message.includes('PlanRun/ApplyRun'));
  } finally {
    restore();
  }
});

test('public v3 deployment follow-up routes are retired', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiFetch(calls, { unexpected: true }, 500);
  try {
    const responses = [
      await app.request(
        retiredDeploymentRouteBuilders.deployment('dep_1'),
        trustedGetInit(),
      ),
      await app.request(
        retiredDeploymentRouteBuilders.deploymentApply('dep_1'),
        trustedJsonInit('POST', {}),
      ),
      await app.request(
        retiredDeploymentRouteBuilders.deploymentApprove('dep_1'),
        trustedJsonInit('POST', { policy_decision_id: 'policy_1' }),
      ),
      await app.request(
        retiredDeploymentRouteBuilders.deploymentObservations('dep_1'),
        trustedGetInit(),
      ),
      await app.request(
        retiredDeploymentRouteBuilders.groupHead('docs'),
        trustedGetInit(),
      ),
      await app.request(
        retiredDeploymentRouteBuilders.groupRollback('docs'),
        trustedJsonInit('POST', { target_id: 'dep_0' }),
      ),
    ];

    for (const response of responses) {
      const body = await response.json() as {
        error: { code: string; message: string };
      };
      deepStrictEqual(response.status, 410);
      deepStrictEqual(body.error.code, 'GONE');
    }
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('public v3 deployment list route is retired', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiFetch(calls, { unexpected: true }, 500);
  try {
    const response = await app.request(
      `${TAKOS_PUBLIC_API_PATHS.deployments}?space_id=space_1&group=docs`,
      trustedGetInit(),
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 410);
    deepStrictEqual(body.error.code, 'GONE');
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('retired group deployment snapshot routes are not exposed by app API', async () => {
  const cases: Array<[string, string]> = [
    ['GET', '/api/spaces/s1/group-deployment-snapshots'],
    ['POST', '/api/spaces/s1/group-deployment-snapshots'],
    ['GET', '/api/spaces/s1/group-deployment-snapshots/snap1'],
    ['POST', '/api/spaces/s1/group-deployment-snapshots/snap1/rollback'],
    ['DELETE', '/api/spaces/s1/group-deployment-snapshots/snap1'],
    ['POST', '/api/spaces/s1/group-deployment-snapshots/plan'],
  ];

  for (const [method, path] of cases) {
    const response = await app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: method === 'GET' ? undefined : '{}',
    });
    deepStrictEqual(response.status, 404);
  }
});

test('canonical group deployment mutation routes are retired', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, { unexpected: true });
  try {
    const response = await app.request(
      '/api/spaces/s1/groups/deployments?trace=1',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'client-controlled',
          authorization: 'Bearer takpat_direct',
        },
        body: JSON.stringify({
          source: {
            kind: 'git_ref',
            repository_url: 'https://example.com/acme/demo.git',
            ref: 'main',
            ref_type: 'branch',
          },
          env: 'staging',
        }),
      },
    );
    const rollback = await app.request(
      '/api/spaces/s1/groups/deployments/appdep_1/rollback',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer takpat_direct',
        },
        body: '{}',
      },
    );
    const rollbackByName = await app.request(
      '/api/spaces/s1/groups/by-name/docs/rollback',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer takpat_direct',
        },
        body: '{}',
      },
    );

    for (const retired of [response, rollback, rollbackByName]) {
      deepStrictEqual(retired.status, 404);
    }
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('canonical group uninstall route is not exposed', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, { unexpected: true });
  try {
    const uninstall = await app.request(
      '/api/spaces/s1/groups/uninstall',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer takpat_direct',
        },
        body: JSON.stringify({ group_name: 'docs' }),
      },
    );

    deepStrictEqual(uninstall.status, 404);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('app installation apply route requires in-process control bindings', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    Response.json({
      installation: {
        installed: true,
        installation_id: 'inst_1',
        app_id: 'jp.takos.docs',
        status: 'ready',
      },
    }, { status: 202 }),
  ]);
  try {
    const response = await app.request(
      '/api/spaces/s1/app-installations/apply?trace=1',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'client-controlled',
          authorization: 'Bearer takpat_direct',
        },
        body: JSON.stringify({ app_id: 'jp.takos.docs' }),
      },
    );

    await assertControlBindingRequired(response);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('retired deploy routes are not exposed by app API', async () => {
  const cases: Array<[string, string]> = [
    ['POST', '/api/deploy/plan'],
    ['POST', '/api/deploy'],
    ['POST', '/api/deploy/rollback'],
    ['POST', '/api/deployments/plan'],
  ];

  for (const [method, path] of cases) {
    const response = await app.request(path, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: '{}',
    });
    deepStrictEqual(response.status, 404);
  }
});

test('retired OAuth provider routes return 404 without proxying', async () => {
  const calls: ExternalFetchCall[] = [];
  const originalIssuerUrl = getEnv('OIDC_ISSUER_URL');
  const restore = stubExternalFetch(calls, { unreachable: true });
  setEnv('OIDC_ISSUER_URL', 'https://accounts.example.test');
  try {
    const token = await app.request('/api/public/v1/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    const legacy = await app.request('/oauth/device?user_code=ABCD-EFGH');
    const wellKnown = await app.request('/.well-known/openid-configuration');
    const consent = await app.request(
      '/api/oauth/authorize/context?client_id=client_1',
    );
    const body = await token.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(token.status, 404);
    deepStrictEqual(legacy.status, 404);
    deepStrictEqual(wellKnown.status, 404);
    deepStrictEqual(consent.status, 404);
    deepStrictEqual(body.error.code, 'NOT_FOUND');
    deepStrictEqual(
      body.error.message,
      'Takos OAuth provider routes are not exposed by Takos.',
    );
    deepStrictEqual(token.headers.get('location'), null);
    deepStrictEqual(wellKnown.headers.get('location'), null);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
    restoreEnv('OIDC_ISSUER_URL', originalIssuerUrl);
  }
});

test('retired publications routes return 404 without proxying', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, { unreachable: true });
  try {
    const publications = await app.request('/api/publications');
    const publication = await app.request('/api/publications/pub_1');
    const body = await publications.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(publications.status, 404);
    deepStrictEqual(publication.status, 404);
    deepStrictEqual(body.error.code, 'NOT_FOUND');
    deepStrictEqual(
      body.error.message,
      'Takos publications routes are not exposed by Takos.',
    );
    deepStrictEqual(publications.headers.get('location'), null);
    deepStrictEqual(publication.headers.get('location'), null);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('account gateway routes use in-process control bindings while retired auth aliases stay closed', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    new Response(null, {
      status: 302,
      headers: { location: 'https://accounts.example.test/oauth/authorize' },
    }),
    Response.json({ id: 'acct_1', username: 'tako' }),
    Response.json({ success: true }),
    Response.json({ success: true }),
  ]);
  try {
    const login = await app.request('/auth/login?return_to=%2Fsettings');
    const retiredExternal = await app.request(
      '/auth/external?return_to=%2Fsettings',
    );
    const retiredExternalCallback = await app.request(
      '/auth/external/callback?code=retired',
    );
    const unknownAuth = await app.request('/auth/unknown');
    const unknownOidc = await app.request('/auth/oidc/unknown');
    const oidcLogin = await app.request(
      '/auth/oidc/login?return_to=%2Fsettings',
    );
    const me = await app.request('/api/me', {
      headers: {
        cookie: '__Host-tp_session=sess_1',
        'x-takos-account-id': 'client-controlled',
      },
    });
    const logout = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: {
        authorization: 'Bearer takpat_direct',
        cookie: '__Host-tp_session=sess_1',
      },
    });
    const browserLogout = await app.request('/auth/logout', {
      method: 'POST',
      headers: {
        cookie: '__Host-tp_session=sess_1',
      },
    });
    const personalAccessTokens = await app.request(
      '/api/me/personal-access-tokens',
      {
        headers: {
          authorization: 'Bearer takpat_direct',
          cookie: '__Host-tp_session=sess_1',
        },
      },
    );
    const personalAccessTokenRevoke = await app.request(
      '/api/me/personal-access-tokens/pat_1',
      {
        method: 'DELETE',
        headers: {
          authorization: 'Bearer takpat_direct',
          cookie: '__Host-tp_session=sess_1',
        },
      },
    );

    deepStrictEqual(login.status, 404);
    deepStrictEqual(retiredExternal.status, 404);
    deepStrictEqual(retiredExternalCallback.status, 404);
    deepStrictEqual(unknownAuth.status, 404);
    deepStrictEqual(unknownOidc.status, 404);
    await assertControlBindingRequired(oidcLogin);
    await assertControlBindingRequired(me);
    await assertControlBindingRequired(logout);
    await assertControlBindingRequired(browserLogout);
    deepStrictEqual(personalAccessTokens.status, 404);
    deepStrictEqual(personalAccessTokenRevoke.status, 404);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('profile gateway routes use in-process control bindings', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    Response.json({ profile: { username: 'alice' }, recent_repos: [] }),
    Response.json({ following: true }),
  ]);
  try {
    const profile = await app.request('/api/users/alice?tab=repos', {
      headers: { 'x-takos-internal-secret': 'client-controlled' },
    });
    const follow = await app.request('/api/users/alice/follow', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer takpat_profile',
      },
      body: '{}',
    });

    await assertControlBindingRequired(profile);
    await assertControlBindingRequired(follow);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('legacy control route families are now retired', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, { unreachable: true });
  try {
    const cases = [
      '/api/repos/repo_1',
      '/api/mcp/servers/srv_1/tools?spaceId=space_1',
      '/api/public/thread-shares/share_1',
    ];

    for (const path of cases) {
      const response = await app.request(path, {
        headers: {
          authorization: 'Bearer takpat_direct',
          'x-takos-internal-secret': 'client-controlled',
        },
      });
      deepStrictEqual(response.status, 404);
    }
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('thread run create route is served by src/routes/public write model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  const queueMessages: Array<Record<string, unknown>> = [];
  const runQueue = {
    send(message: Record<string, unknown>) {
      queueMessages.push(message);
      return Promise.resolve();
    },
    sendBatch() {
      return Promise.resolve();
    },
  };
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'editor',
      runId: 'seed_run',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const response = await app.request(
      '/api/threads/thread_1/runs',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({
          agent_type: 'default',
          input: { prompt: 'hello' },
          model: 'gpt-5.5',
        }),
      },
      { DB: db, RUN_QUEUE: runQueue },
    );
    const invalid = await app.request(
      '/api/threads/thread_1/runs',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ input: 'bad' }),
      },
      { DB: db, RUN_QUEUE: runQueue },
    );
    const forbidden = await app.request(
      '/api/threads/thread_1/runs',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ input: {} }),
      },
      {
        DB: fakeApiDb({
          actorAccountId: 'acct_1',
          membershipRole: 'viewer',
          runId: 'seed_run',
          threadId: 'thread_1',
          spaceId: 'space_1',
        }),
        RUN_QUEUE: runQueue,
      },
    );
    const missingQueue = await app.request(
      '/api/threads/thread_1/runs',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ input: {} }),
      },
      { DB: db },
    );

    const body = await response.json() as {
      run: { id: string; thread_id: string; status: string; input: string };
    };

    deepStrictEqual(response.status, 201);
    deepStrictEqual(body.run.thread_id, 'thread_1');
    deepStrictEqual(body.run.status, 'queued');
    deepStrictEqual(JSON.parse(body.run.input), { prompt: 'hello' });
    deepStrictEqual(queueMessages.length, 1);
    deepStrictEqual(queueMessages[0].runId, body.run.id);
    deepStrictEqual(queueMessages[0].model, 'gpt-5.5');
    deepStrictEqual(invalid.status, 400);
    deepStrictEqual(forbidden.status, 404);
    deepStrictEqual(missingQueue.status, 503);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
    restoreEnv();
  }
});

test('single Worker route split serves chat, memory tools, agent queue, and Git proxy', async () => {
  const gitCalls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restoreGit = stubGitFetch(gitCalls, JSON.stringify({ refs: [] }));
  const queueMessages: Array<Record<string, unknown>> = [];
  const runQueue = {
    send(message: Record<string, unknown>) {
      queueMessages.push(message);
      return Promise.resolve();
    },
    sendBatch() {
      return Promise.resolve();
    },
  };
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'editor',
    runId: 'seed_run',
    threadId: 'thread_1',
    spaceId: 'space_1',
    messages: [],
  });

  try {
    const createdThread = await app.request(
      '/api/spaces/space_1/threads',
      trustedJsonInit('POST', { title: 'Runtime proof', locale: 'ja' }),
      { DB: db },
    );
    const createdThreadBody = await createdThread.json() as {
      thread: { id: string; title: string };
    };

    const message = await app.request(
      `/api/threads/${createdThreadBody.thread.id}/messages`,
      trustedJsonInit('POST', {
        role: 'user',
        content: 'remember this local runtime proof',
      }),
      { DB: db },
    );
    const messages = await app.request(
      `/api/threads/${createdThreadBody.thread.id}/messages`,
      trustedGetInit(),
      { DB: db },
    );
    const tools = await app.request(
      '/api/spaces/space_1/tools',
      trustedGetInit(),
      { DB: db },
    );
    const rememberTool = await app.request(
      '/api/spaces/space_1/tools/remember',
      trustedGetInit(),
      { DB: db },
    );
    const run = await app.request(
      `/api/threads/${createdThreadBody.thread.id}/runs`,
      trustedJsonInit('POST', {
        agent_type: 'default',
        input: { prompt: 'use the memory tool' },
        model: 'gpt-5.5',
      }),
      { DB: db, RUN_QUEUE: runQueue },
    );
    const gitRefs = await app.request(
      '/api/repositories/repo_1/refs?spaceId=space_1',
      trustedGetInit(),
      { DB: db },
    );

    const messageBody = await message.json() as {
      message: { thread_id: string; content: string };
    };
    const messagesBody = await messages.json() as {
      messages: Array<{ content: string }>;
    };
    const toolsBody = await tools.json() as {
      data: Array<{ name: string; inputSchema: unknown }>;
    };
    const rememberToolBody = await rememberTool.json() as {
      data: { name: string; inputSchema: { properties: Record<string, unknown> } };
    };
    const runBody = await run.json() as {
      run: { id: string; thread_id: string; status: string; agent_type: string };
    };

    deepStrictEqual(createdThread.status, 201);
    deepStrictEqual(createdThreadBody.thread.title, 'Runtime proof');
    deepStrictEqual(message.status, 201);
    deepStrictEqual(messageBody.message.thread_id, createdThreadBody.thread.id);
    deepStrictEqual(
      messageBody.message.content,
      'remember this local runtime proof',
    );
    deepStrictEqual(messages.status, 200);
    deepStrictEqual(messagesBody.messages.length, 1);
    deepStrictEqual(tools.status, 200);
    deepStrictEqual(
      toolsBody.data.some((tool) => tool.name === 'remember'),
      true,
    );
    deepStrictEqual(rememberTool.status, 200);
    deepStrictEqual(rememberToolBody.data.name, 'remember');
    deepStrictEqual(
      Object.hasOwn(rememberToolBody.data.inputSchema.properties, 'content'),
      true,
    );
    deepStrictEqual(run.status, 201);
    deepStrictEqual(runBody.run.thread_id, createdThreadBody.thread.id);
    deepStrictEqual(runBody.run.status, 'queued');
    deepStrictEqual(runBody.run.agent_type, 'default');
    deepStrictEqual(queueMessages.length, 1);
    deepStrictEqual(queueMessages[0].runId, runBody.run.id);
    deepStrictEqual(queueMessages[0].model, 'gpt-5.5');
    deepStrictEqual(gitRefs.status, 200);
    deepStrictEqual(gitCalls.length, 1);
    deepStrictEqual(
      new URL(gitCalls[0].url).pathname,
      '/internal/repositories/repo_1/refs',
    );
    deepStrictEqual(
      gitCalls[0].headers.get('x-takosumi-audience'),
      'takos-git',
    );
  } finally {
    restoreGit();
  }
});

test('thread export route is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      messages: [
        fakeMessageRow({
          messageId: 'msg_1',
          threadId: 'thread_1',
          role: 'user',
          sequence: 0,
          content: 'hello',
        }),
        fakeMessageRow({
          messageId: 'msg_2',
          threadId: 'thread_1',
          role: 'system',
          sequence: 1,
          content: 'internal',
        }),
      ],
    });
    const json = await app.request(
      '/api/threads/thread_1/export?format=json&include_internal=1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const markdown = await app.request(
      '/api/threads/thread_1/export',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const invalid = await app.request(
      '/api/threads/thread_1/export?format=zip',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const pdf = await app.request(
      '/api/threads/thread_1/export?format=pdf',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/threads/missing/export',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const adminDb = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'admin',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      messages: [
        fakeMessageRow({
          messageId: 'msg_1',
          threadId: 'thread_1',
          role: 'user',
          sequence: 0,
          content: 'hello',
        }),
        fakeMessageRow({
          messageId: 'msg_2',
          threadId: 'thread_1',
          role: 'system',
          sequence: 1,
          content: 'internal',
        }),
      ],
    });
    const adminJson = await app.request(
      '/api/threads/thread_1/export?format=json&include_internal=1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: adminDb },
    );
    const body = await json.json() as {
      thread: {
        id: string;
        title: string | null;
        created_at: string;
        updated_at: string;
      };
      messages: Array<{
        role: string;
        content: string;
        sequence: number;
        created_at: string;
      }>;
    };
    const adminBody = await adminJson.json() as {
      messages: Array<{ role: string; content: string; sequence: number }>;
    };
    const markdownBody = await markdown.text();
    const invalidBody = await invalid.json() as { error: string };
    const pdfBody = await pdf.json() as { error: string };

    deepStrictEqual(json.status, 200);
    deepStrictEqual(
      json.headers.get('content-type'),
      'application/json; charset=utf-8',
    );
    deepStrictEqual(
      json.headers.get('content-disposition'),
      'attachment; filename="Thread-title-thread_1.json"',
    );
    deepStrictEqual(json.headers.get('cache-control'), 'no-store');
    deepStrictEqual(body.thread, {
      id: 'thread_1',
      title: 'Thread title',
      created_at: '2026-05-13T00:00:00.000Z',
      updated_at: '2026-05-13T00:03:00.000Z',
    });
    deepStrictEqual(body.messages, [{
      role: 'user',
      content: 'hello',
      sequence: 0,
      created_at: '2026-05-13T00:00:00.000Z',
    }]);
    deepStrictEqual(markdown.status, 200);
    deepStrictEqual(
      markdown.headers.get('content-type'),
      'text/markdown; charset=utf-8',
    );
    ok(markdownBody, '# Thread title');
    ok(markdownBody, '### #0 [user]');
    deepStrictEqual(markdownBody.includes('internal'), false);
    deepStrictEqual(adminJson.status, 200);
    deepStrictEqual(adminBody.messages.map((message) => message.role), [
      'user',
      'system',
    ]);
    deepStrictEqual(invalid.status, 400);
    deepStrictEqual(
      invalidBody.error,
      'Invalid format. Supported: markdown, json, pdf',
    );
    deepStrictEqual(pdf.status, 503);
    deepStrictEqual(pdfBody.error, 'PDF export renderer is not configured');
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread mutation routes are served by src/routes/public write model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'editor',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const created = await app.request(
      '/api/spaces/space_1/threads',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ title: 'New thread', locale: 'en' }),
      },
      { DB: db },
    );
    const createdBody = await created.json() as {
      thread: { id: string; title: string; locale: string; status: string };
    };
    const patched = await app.request(
      `/api/threads/${createdBody.thread.id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({
          title: 'Updated thread',
          locale: null,
          context_window: 80,
        }),
      },
      { DB: db },
    );
    const archived = await app.request(
      `/api/threads/${createdBody.thread.id}/archive`,
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const unarchived = await app.request(
      `/api/threads/${createdBody.thread.id}/unarchive`,
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const invalidPatch = await app.request(
      `/api/threads/${createdBody.thread.id}`,
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ context_window: 10 }),
      },
      { DB: db },
    );
    const viewerDb = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const forbiddenDelete = await app.request(
      '/api/threads/thread_1',
      {
        method: 'DELETE',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: viewerDb },
    );
    const ownerDb = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'owner',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const deleted = await app.request(
      '/api/threads/thread_1',
      {
        method: 'DELETE',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: ownerDb },
    );
    const patchedBody = await patched.json() as {
      thread: {
        title: string;
        locale: string | null;
        context_window: number;
      };
    };

    deepStrictEqual(created.status, 201);
    deepStrictEqual(createdBody.thread.title, 'New thread');
    deepStrictEqual(createdBody.thread.locale, 'en');
    deepStrictEqual(createdBody.thread.status, 'active');
    deepStrictEqual(patched.status, 200);
    deepStrictEqual(patchedBody.thread.title, 'Updated thread');
    deepStrictEqual(patchedBody.thread.locale, null);
    deepStrictEqual(patchedBody.thread.context_window, 80);
    deepStrictEqual(archived.status, 200);
    deepStrictEqual(await archived.json(), { success: true });
    deepStrictEqual(unarchived.status, 200);
    deepStrictEqual(await unarchived.json(), { success: true });
    deepStrictEqual(invalidPatch.status, 400);
    deepStrictEqual(forbiddenDelete.status, 404);
    deepStrictEqual(deleted.status, 200);
    deepStrictEqual(await deleted.json(), { success: true });
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread history route is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      messages: [
        fakeMessageRow({
          messageId: 'msg_1',
          threadId: 'thread_1',
          sequence: 0,
          content: 'history message',
        }),
      ],
      runs: [
        fakeRunDetailRow({
          runId: 'run_1',
          threadId: 'thread_1',
          spaceId: 'space_1',
          status: 'completed',
          sessionId: 'sess_1',
          rootThreadId: 'thread_1',
          rootRunId: 'run_1',
          completedAt: '2026-05-13T00:02:00.000Z',
          createdAt: '2026-05-13T00:00:00.000Z',
        }),
        fakeRunDetailRow({
          runId: 'run_2',
          threadId: 'thread_1',
          spaceId: 'space_1',
          status: 'running',
          rootThreadId: 'thread_1',
          rootRunId: 'run_1',
          createdAt: '2026-05-13T00:03:00.000Z',
        }),
      ],
      artifacts: [fakeArtifactRow('artifact_1', 'run_1', 'space_1')],
      runEvents: [
        fakeRunEventRow({
          id: 1,
          runId: 'run_1',
          type: 'run_status',
          data: '{"status":"completed"}',
          createdAt: '2026-05-13T00:02:00.000Z',
        }),
        fakeRunEventRow({
          id: 2,
          runId: 'run_2',
          type: 'message',
          data: '{"content":"running"}',
          createdAt: '2026-05-13T00:04:00.000Z',
        }),
      ],
      agentTasks: [
        fakeAgentTaskRow({
          taskId: 'task_1',
          threadId: 'thread_1',
          status: 'in_progress',
          priority: 'high',
        }),
      ],
      sessions: [
        fakeSessionRow({
          sessionId: 'sess_1',
          status: 'ready',
          repoId: 'repo_1',
        }),
      ],
    });
    const response = await app.request(
      '/api/threads/thread_1/history?limit=1&offset=0',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const noMessages = await app.request(
      '/api/threads/thread_1/history?include_messages=0',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/threads/missing/history',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const body = await response.json() as {
      messages: Array<{ id: string; content: string }>;
      total: number;
      limit: number;
      offset: number;
      runs: Array<{
        run: { id: string };
        artifact_count: number;
        latest_event_at: string;
        artifacts: Array<{ id: string }>;
        events: Array<{ id: number }>;
      }>;
      focus: {
        latest_run_id: string | null;
        latest_active_run_id: string | null;
        latest_completed_run_id: string | null;
        resume_run_id: string | null;
      };
      activeRun: { id: string } | null;
      pendingSessionDiff: {
        sessionId: string;
        sessionStatus: string;
        git_mode: boolean;
      } | null;
      taskContext: {
        id: string;
        title: string;
        status: string;
        priority: string;
      } | null;
    };
    const noMessagesBody = await noMessages.json() as {
      messages: unknown[];
      total: number;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(noMessages.status, 200);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(body.messages.map((message) => message.id), ['msg_1']);
    deepStrictEqual(body.total, 1);
    deepStrictEqual(body.limit, 1);
    deepStrictEqual(body.offset, 0);
    deepStrictEqual(body.runs.map((run) => run.run.id), ['run_1', 'run_2']);
    deepStrictEqual(body.runs[0].artifact_count, 1);
    deepStrictEqual(body.runs[0].artifacts.map((artifact) => artifact.id), [
      'artifact_1',
    ]);
    deepStrictEqual(body.runs[1].events.map((event) => event.id), [2]);
    deepStrictEqual(body.runs[1].latest_event_at, '2026-05-13T00:04:00.000Z');
    deepStrictEqual(body.focus.latest_run_id, 'run_2');
    deepStrictEqual(body.focus.latest_active_run_id, 'run_2');
    deepStrictEqual(body.focus.latest_completed_run_id, 'run_1');
    deepStrictEqual(body.focus.resume_run_id, 'run_2');
    deepStrictEqual(body.activeRun?.id, 'run_2');
    deepStrictEqual(body.pendingSessionDiff, {
      sessionId: 'sess_1',
      sessionStatus: 'ready',
      git_mode: true,
    });
    deepStrictEqual(body.taskContext, {
      id: 'task_1',
      title: 'Task title',
      status: 'in_progress',
      priority: 'high',
    });
    deepStrictEqual(noMessagesBody.messages, []);
    deepStrictEqual(noMessagesBody.total, 0);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread search routes are served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      messages: [
        fakeMessageRow({
          messageId: 'msg_1',
          threadId: 'thread_1',
          sequence: 0,
          content: 'hello from takos',
        }),
        fakeMessageRow({
          messageId: 'msg_2',
          threadId: 'thread_1',
          sequence: 1,
          content: 'other content',
        }),
      ],
    });
    const spaceSearch = await app.request(
      '/api/spaces/space_1/threads/search?q=hello',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const messageSearch = await app.request(
      '/api/threads/thread_1/messages/search?q=hello',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missingQuery = await app.request(
      '/api/threads/thread_1/messages/search',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missingThread = await app.request(
      '/api/threads/missing/messages/search?q=hello',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const spaceBody = await spaceSearch.json() as {
      results: Array<{
        thread: { id: string };
        message: { id: string };
        snippet: string;
      }>;
      semantic_available: boolean;
    };
    const messageBody = await messageSearch.json() as {
      results: Array<{ message: { id: string }; snippet: string }>;
      semantic_available: boolean;
    };

    deepStrictEqual(spaceSearch.status, 200);
    deepStrictEqual(messageSearch.status, 200);
    deepStrictEqual(missingQuery.status, 400);
    deepStrictEqual(missingThread.status, 404);
    deepStrictEqual(spaceBody.results[0].thread.id, 'thread_1');
    deepStrictEqual(spaceBody.results[0].message.id, 'msg_1');
    deepStrictEqual(spaceBody.results[0].snippet, 'hello from takos');
    deepStrictEqual(spaceBody.semantic_available, false);
    deepStrictEqual(messageBody.results[0].message.id, 'msg_1');
    deepStrictEqual(messageBody.results[0].snippet, 'hello from takos');
    deepStrictEqual(messageBody.semantic_available, false);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread message create route is served by src/routes/public write model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'editor',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      messages: [
        fakeMessageRow({
          messageId: 'msg_1',
          threadId: 'thread_1',
          sequence: 0,
        }),
      ],
    });
    const response = await app.request(
      '/api/threads/thread_1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ role: 'user', content: 'hello' }),
      },
      { DB: db },
    );
    const invalid = await app.request(
      '/api/threads/thread_1/messages',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ role: 'user' }),
      },
      { DB: db },
    );
    const viewerDb = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const forbidden = await app.request('/api/threads/thread_1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: JSON.stringify({ role: 'user', content: 'viewer' }),
    }, { DB: viewerDb });
    const body = await response.json() as {
      message: {
        id: string;
        thread_id: string;
        content: string;
        sequence: number;
      };
    };

    deepStrictEqual(response.status, 201);
    deepStrictEqual(invalid.status, 400);
    deepStrictEqual(forbidden.status, 404);
    deepStrictEqual(body.message.thread_id, 'thread_1');
    deepStrictEqual(body.message.content, 'hello');
    deepStrictEqual(body.message.sequence, 1);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread share create route is served by src/routes/public write model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'editor',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const response = await app.request(
      'https://takos.test/api/threads/thread_1/share',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ mode: 'public', expires_in_days: 1 }),
      },
      { DB: db },
    );
    const invalid = await app.request(
      '/api/threads/thread_1/share',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ expires_in_days: 400 }),
      },
      { DB: db },
    );
    const viewerDb = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const forbidden = await app.request('/api/threads/thread_1/share', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: JSON.stringify({ mode: 'public' }),
    }, { DB: viewerDb });
    const body = await response.json() as {
      share: {
        id: string;
        thread_id: string;
        space_id: string;
        token: string;
        mode: string;
        share_path: string;
        share_url: string;
      };
      share_path: string;
      share_url: string;
      password_required: boolean;
    };

    deepStrictEqual(response.status, 201);
    deepStrictEqual(invalid.status, 400);
    deepStrictEqual(forbidden.status, 404);
    deepStrictEqual(body.share.thread_id, 'thread_1');
    deepStrictEqual(body.share.space_id, 'space_1');
    deepStrictEqual(body.share.mode, 'public');
    deepStrictEqual(body.password_required, false);
    deepStrictEqual(body.share_path, `/share/${body.share.token}`);
    deepStrictEqual(
      body.share_url,
      `https://takos.test/share/${body.share.token}`,
    );
    deepStrictEqual(body.share.share_path, body.share_path);
    deepStrictEqual(body.share.share_url, body.share_url);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread share list route is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      threadShares: [
        fakeThreadShareRow({
          shareId: 'share_1',
          threadId: 'thread_1',
          spaceId: 'space_1',
          token: 'abc123',
        }),
      ],
    });
    const response = await app.request(
      'https://takos.test/api/threads/thread_1/shares',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      'https://takos.test/api/threads/missing/shares',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const body = await response.json() as {
      shares: Array<{
        id: string;
        share_path: string;
        share_url: string;
      }>;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(
      body.shares.map((share) => ({
        id: share.id,
        share_path: share.share_path,
        share_url: share.share_url,
      })),
      [{
        id: 'share_1',
        share_path: '/share/abc123',
        share_url: 'https://takos.test/share/abc123',
      }],
    );
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread share revoke route is served by src/routes/public write model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'editor',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      threadShares: [
        fakeThreadShareRow({
          shareId: 'share_1',
          threadId: 'thread_1',
          spaceId: 'space_1',
          token: 'abc123',
        }),
      ],
    });
    const response = await app.request(
      '/api/threads/thread_1/shares/share_1/revoke',
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/threads/thread_1/shares/missing/revoke',
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const viewerDb = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      threadShares: [
        fakeThreadShareRow({
          shareId: 'share_2',
          threadId: 'thread_1',
          spaceId: 'space_1',
          token: 'def456',
        }),
      ],
    });
    const forbidden = await app.request(
      '/api/threads/thread_1/shares/share_2/revoke',
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: viewerDb },
    );

    deepStrictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { success: true });
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(forbidden.status, 404);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('space thread list route is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
      threads: [
        fakeThreadRow({
          threadId: 'thread_active',
          spaceId: 'space_1',
          status: 'active',
          updatedAt: '2026-05-13T00:03:00.000Z',
        }),
        fakeThreadRow({
          threadId: 'thread_archived',
          spaceId: 'space_1',
          status: 'archived',
          updatedAt: '2026-05-13T00:02:00.000Z',
        }),
        fakeThreadRow({
          threadId: 'thread_deleted',
          spaceId: 'space_1',
          status: 'deleted',
          updatedAt: '2026-05-13T00:01:00.000Z',
        }),
      ],
    });
    const response = await app.request(
      '/api/spaces/space_1/threads',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const archived = await app.request(
      '/api/spaces/space_1/threads?status=archived',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const body = await response.json() as {
      threads: Array<{ id: string; status: string }>;
    };
    const archivedBody = await archived.json() as {
      threads: Array<{ id: string; status: string }>;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(archived.status, 200);
    deepStrictEqual(
      body.threads.map((thread) => thread.id),
      ['thread_active', 'thread_archived'],
    );
    deepStrictEqual(
      archivedBody.threads.map((thread) => [thread.id, thread.status]),
      [['thread_archived', 'archived']],
    );
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread messages route is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      messages: [
        fakeMessageRow({
          messageId: 'msg_1',
          threadId: 'thread_1',
          sequence: 0,
        }),
        fakeMessageRow({
          messageId: 'msg_2',
          threadId: 'thread_1',
          sequence: 1,
          content: 'second',
        }),
      ],
      runs: [
        fakeRunDetailRow({
          runId: 'run_1',
          threadId: 'thread_1',
          spaceId: 'space_1',
          status: 'completed',
        }),
      ],
    });
    const response = await app.request(
      '/api/threads/thread_1/messages?limit=1&offset=1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/threads/missing/messages',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const body = await response.json() as {
      messages: Array<{ id: string; thread_id: string; content: string }>;
      total: number;
      runs: Array<{ id: string; thread_id: string }>;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(
      body.messages.map((message) => ({
        id: message.id,
        thread_id: message.thread_id,
        content: message.content,
      })),
      [{
        id: 'msg_2',
        thread_id: 'thread_1',
        content: 'second',
      }],
    );
    deepStrictEqual(body.total, 2);
    deepStrictEqual(body.runs.map((run) => run.id), ['run_1']);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread detail route is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
    });
    const response = await app.request(
      '/api/threads/thread_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/threads/missing',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const body = await response.json() as {
      thread: {
        id: string;
        space_id: string;
        locale: string | null;
        key_points: string;
        retrieval_index: number;
        context_window: number;
      };
      role: string;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(body.thread.id, 'thread_1');
    deepStrictEqual(body.thread.space_id, 'space_1');
    deepStrictEqual(body.thread.locale, 'ja');
    deepStrictEqual(body.thread.key_points, '[]');
    deepStrictEqual(body.thread.retrieval_index, -1);
    deepStrictEqual(body.thread.context_window, 50);
    deepStrictEqual(body.role, 'viewer');
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('thread run list route is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      runs: [
        fakeRunDetailRow({
          runId: 'run_2',
          threadId: 'thread_1',
          spaceId: 'space_1',
          status: 'running',
          createdAt: '2026-05-13T00:02:00.000Z',
        }),
        fakeRunDetailRow({
          runId: 'run_1',
          threadId: 'thread_1',
          spaceId: 'space_1',
          status: 'queued',
          createdAt: '2026-05-13T00:01:00.000Z',
        }),
      ],
    });
    const response = await app.request(
      '/api/threads/thread_1/runs?active_only=1&limit=1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/threads/missing/runs',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const invalidCursor = await app.request(
      '/api/threads/thread_1/runs?cursor=not-a-date',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const body = await response.json() as {
      runs: Array<{ id: string; thread_id: string; space_id: string }>;
      limit: number;
      active_only: boolean;
      cursor: string | null;
      next_cursor: string | null;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(invalidCursor.status, 400);
    deepStrictEqual(body.runs.map((run) => run.id), ['run_2']);
    deepStrictEqual(body.runs[0].thread_id, 'thread_1');
    deepStrictEqual(body.runs[0].space_id, 'space_1');
    deepStrictEqual(body.limit, 1);
    deepStrictEqual(body.active_only, true);
    deepStrictEqual(body.cursor, null);
    deepStrictEqual(
      body.next_cursor,
      '2026-05-13T00:02:00.000Z,run_2',
    );
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('run detail is served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const response = await app.request(
      '/api/runs/run_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      {
        DB: fakeApiDb({
          actorAccountId: 'acct_1',
          membershipRole: 'viewer',
          runId: 'run_1',
          spaceId: 'space_1',
        }),
      },
    );
    const body = await response.json() as {
      run: { id: string; space_id: string; root_run_id: string };
      role: string;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(body.run.id, 'run_1');
    deepStrictEqual(body.run.space_id, 'space_1');
    deepStrictEqual(body.run.root_run_id, 'run_1');
    deepStrictEqual(body.role, 'viewer');
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('run websocket route is served by src/routes/public notifier access check', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  const notifierCalls: Array<{
    url: string;
    method: string;
    headers: Headers;
  }> = [];
  const runNotifier = {
    idFromName(name: string) {
      return { name };
    },
    get() {
      return {
        fetch: async (request: Request) => {
          notifierCalls.push({
            url: request.url,
            method: request.method,
            headers: new Headers(request.headers),
          });
          return await Promise.resolve(Response.json({ websocket: true }));
        },
      };
    },
  };
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const websocket = await app.request(
      '/api/runs/run_1/ws?last_event_id=42',
      {
        headers: {
          'Upgrade': 'websocket',
          'authorization': 'Bearer keep',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
          'x-takos-roles': 'client-controlled',
          'X-WS-Auth-Validated': 'client-controlled',
        },
      },
      { DB: db, RUN_NOTIFIER: runNotifier },
    );
    const badUpgrade = await app.request(
      '/api/runs/run_1/ws',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db, RUN_NOTIFIER: runNotifier },
    );

    deepStrictEqual(websocket.status, 200);
    deepStrictEqual(badUpgrade.status, 426);
    deepStrictEqual(notifierCalls.length, 1);
    deepStrictEqual(new URL(notifierCalls[0].url).pathname, '/api/runs/run_1/ws');
    deepStrictEqual(
      new URL(notifierCalls[0].url).searchParams.get('last_event_id'),
      '42',
    );
    deepStrictEqual(notifierCalls[0].headers.get('x-ws-auth-validated'), 'true');
    deepStrictEqual(notifierCalls[0].headers.get('x-ws-user-id'), 'acct_1');
    deepStrictEqual(notifierCalls[0].headers.get('x-takos-internal-secret'), null);
    deepStrictEqual(notifierCalls[0].headers.get('x-takos-account-id'), null);
    deepStrictEqual(notifierCalls[0].headers.get('x-takos-roles'), null);
    deepStrictEqual(notifierCalls[0].headers.get('authorization'), 'Bearer keep');
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('run sse route is served by src/routes/public observation stream', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
      runEvents: [
        fakeRunEventRow({
          id: 1,
          runId: 'run_1',
          type: 'started',
          data: '{}',
        }),
        fakeRunEventRow({
          id: 2,
          runId: 'run_1',
          type: 'completed',
          data: JSON.stringify({ status: 'completed' }),
        }),
      ],
    });
    const response = await app.request(
      '/api/runs/run_1/sse',
      {
        headers: {
          'Last-Event-ID': '1',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const invalid = await app.request(
      '/api/runs/run_1/sse?last_event_id=bad',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/runs/missing/sse',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );

    const body = await response.text();
    const invalidBody = await invalid.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(response.headers.get('content-type'), 'text/event-stream');
    ok(body, ': connected\n\n');
    ok(body, 'id: 2\n');
    ok(body, 'event: completed\n');
    ok(body, 'data: {"status":"completed"}');
    deepStrictEqual(invalid.status, 400);
    deepStrictEqual(invalidBody.error.code, 'INVALID_ARGUMENT');
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('run cancel route is served by src/routes/public write model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'editor',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      runs: [
        fakeRunDetailRow({
          runId: 'run_1',
          threadId: 'thread_1',
          spaceId: 'space_1',
          status: 'running',
          sessionId: 'sess_1',
        }),
      ],
    });
    const response = await app.request(
      '/api/runs/run_1/cancel',
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const events = await app.request(
      '/api/runs/run_1/events?last_event_id=0',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const finished = await app.request(
      '/api/runs/run_1/cancel',
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/runs/missing/cancel',
      {
        method: 'POST',
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const body = await response.json() as { success: boolean };
    const eventsBody = await events.json() as {
      events: Array<{ type: string; data: string }>;
      run_status: string;
    };

    deepStrictEqual(response.status, 200);
    deepStrictEqual(body, { success: true });
    deepStrictEqual(events.status, 200);
    deepStrictEqual(eventsBody.run_status, 'cancelled');
    deepStrictEqual(eventsBody.events.map((event) => event.type), ['cancelled']);
    deepStrictEqual(JSON.parse(eventsBody.events[0].data), {
      status: 'cancelled',
      run: { id: 'run_1', session_id: 'sess_1' },
    });
    deepStrictEqual(finished.status, 400);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('run observation routes are served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      threadId: 'thread_1',
      spaceId: 'space_1',
      runs: [
        fakeRunDetailRow({
          runId: 'run_1',
          threadId: 'thread_1',
          spaceId: 'space_1',
          status: 'running',
        }),
      ],
      runEvents: [
        fakeRunEventRow({
          id: 1,
          runId: 'run_1',
          type: 'message',
          data: '{"content":"hello"}',
        }),
        fakeRunEventRow({
          id: 2,
          runId: 'run_1',
          type: 'run_status',
          data: '{"status":"completed"}',
        }),
      ],
    });
    const events = await app.request(
      '/api/runs/run_1/events?last_event_id=1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const replay = await app.request(
      '/api/runs/run_1/replay?after=0',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const invalid = await app.request(
      '/api/runs/run_1/events?last_event_id=-1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/runs/missing/replay',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const eventsBody = await events.json() as {
      events: Array<{ id: number; event_id: string; type: string }>;
      run_status: string;
    };
    const replayBody = await replay.json() as {
      events: Array<{ id: number; event_id: string; type: string }>;
      run_status: string;
    };

    deepStrictEqual(events.status, 200);
    deepStrictEqual(replay.status, 200);
    deepStrictEqual(invalid.status, 400);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(eventsBody.events.map((event) => event.id), [2]);
    deepStrictEqual(eventsBody.events[0].event_id, '2');
    deepStrictEqual(eventsBody.run_status, 'completed');
    deepStrictEqual(replayBody.events.map((event) => event.id), [1, 2]);
    deepStrictEqual(replayBody.run_status, 'completed');
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('run artifact read routes are served by src/routes/public read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
      artifacts: [fakeArtifactRow('artifact_1', 'run_1', 'space_1')],
    });
    const list = await app.request(
      '/api/runs/run_1/artifacts',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const detail = await app.request(
      '/api/artifacts/artifact_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missing = await app.request(
      '/api/artifacts/missing',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const listBody = await list.json() as {
      artifacts: Array<{ id: string; run_id: string; space_id: string }>;
    };
    const detailBody = await detail.json() as {
      artifact: { id: string; run_id: string; space_id: string };
    };

    deepStrictEqual(list.status, 200);
    deepStrictEqual(detail.status, 200);
    deepStrictEqual(missing.status, 404);
    deepStrictEqual(
      listBody.artifacts.map((artifact) => ({
        id: artifact.id,
        run_id: artifact.run_id,
        space_id: artifact.space_id,
      })),
      [{
        id: 'artifact_1',
        run_id: 'run_1',
        space_id: 'space_1',
      }],
    );
    deepStrictEqual(detailBody.artifact.id, 'artifact_1');
    deepStrictEqual(detailBody.artifact.space_id, 'space_1');
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('run artifact create route is served by src/routes/public write model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'editor',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const response = await app.request(
      '/api/runs/run_1/artifacts',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({
          type: 'doc',
          title: 'Result',
          content: 'done',
          metadata: { source: 'test' },
        }),
      },
      { DB: db },
    );
    const invalid = await app.request(
      '/api/runs/run_1/artifacts',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ type: 'unknown' }),
      },
      { DB: db },
    );
    const viewerDb = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const forbidden = await app.request(
      '/api/runs/run_1/artifacts',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ type: 'doc', title: 'Viewer' }),
      },
      { DB: viewerDb },
    );
    const body = await response.json() as {
      artifact: {
        run_id: string;
        space_id: string;
        type: string;
        title: string;
        content: string;
        metadata: string;
      };
    };

    deepStrictEqual(response.status, 201);
    deepStrictEqual(invalid.status, 400);
    deepStrictEqual(forbidden.status, 404);
    deepStrictEqual(body.artifact.run_id, 'run_1');
    deepStrictEqual(body.artifact.space_id, 'space_1');
    deepStrictEqual(body.artifact.type, 'doc');
    deepStrictEqual(body.artifact.title, 'Result');
    deepStrictEqual(body.artifact.content, 'done');
    deepStrictEqual(body.artifact.metadata, JSON.stringify({ source: 'test' }));
    deepStrictEqual(calls.length, 0);
  } finally {
    restoreControl();
    restoreEnv();
  }
});

test('space tools read routes are served by src/routes/public catalog', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    Response.json({ data: [] }),
    Response.json({ data: { id: 'space.source.search' } }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const list = await app.request(
      '/api/spaces/space_1/tools?kind=custom',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const detail = await app.request(
      '/api/spaces/space_1/tools/container_start',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missingTool = await app.request(
      '/api/spaces/space_1/tools/not_a_tool',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const nonMember = await app.request(
      '/api/spaces/space_1/tools',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      {
        DB: fakeApiDb({
          actorAccountId: 'acct_1',
          membershipRole: null,
          runId: 'run_1',
          spaceId: 'space_1',
        }),
      },
    );
    const missingDb = await app.request('/api/spaces/space_1/tools', {
      headers: {
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
    });
    const postFallback = await app.request('/api/spaces/space_1/tools', {
      method: 'POST',
      headers: {
        authorization: 'Bearer takpat_direct',
        'content-type': 'application/json',
        'x-takos-internal-secret': 'client-controlled',
        'x-takos-account-id': 'client-controlled',
      },
      body: JSON.stringify({ name: 'not-supported' }),
    });
    const listBody = await list.json() as {
      data: Array<{ id: string; name: string; inputSchema: unknown }>;
    };
    const detailBody = await detail.json() as {
      data: { id: string; name: string; inputSchema: unknown };
    };
    const missingToolBody = await missingTool.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(list.status, 200);
    deepStrictEqual(detail.status, 200);
    deepStrictEqual(missingTool.status, 404);
    deepStrictEqual(nonMember.status, 404);
    deepStrictEqual(missingDb.status, 500);
    await assertControlBindingRequired(postFallback);
    deepStrictEqual(
      listBody.data.some((tool) => tool.name === 'container_start'),
      true,
    );
    deepStrictEqual(detailBody.data.id, 'container_start');
    deepStrictEqual(detailBody.data.name, 'container_start');
    deepStrictEqual(missingToolBody.error.code, 'NOT_FOUND');
    deepStrictEqual(missingToolBody.error.message, 'Custom tool not found');
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
    restoreEnv();
  }
});

test('unknown explore routes return 404 without proxying', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    Response.json({ items: [] }),
  ]);
  try {
    const unknownTypeProbe = await app.request(
      '/api/explore/unmigrated-probe?q=docs&space_id=space_1',
      {
        headers: {
          authorization: 'Bearer takpat_direct',
          'x-takos-internal-secret': 'client-controlled',
          'x-takos-account-id': 'client-controlled',
        },
      },
    );

    deepStrictEqual(unknownTypeProbe.status, 404);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('explore catalog route is served by src/routes/public catalog service', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  const originalList = exploreCatalogRouteDeps.listCatalogItems;
  const originalDefaultApps = exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap;
  const originalAccounts = exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig;
  const catalogCalls: unknown[] = [];
  exploreCatalogRouteDeps.listCatalogItems = ((_, options) => {
    catalogCalls.push(options);
    return Promise.resolve({
      items: [],
      total: 0,
      has_more: false,
    });
  }) as typeof exploreCatalogRouteDeps.listCatalogItems;
  exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap = (() =>
    Promise.resolve(
      [],
    )) as typeof exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap;
  exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig = ((
    _,
  ) => null) as typeof exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig;
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const catalog = await app.request(
      '/api/explore/catalog?q=docs&sort=downloads&type=deployable-app&space_id=space_1&category=app&language=typescript&license=mit&since=2026-02-01&tags=cli,tools&certified_only=true&limit=10&offset=20',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db, ADMIN_DOMAIN: 'takos.example.test' },
    );
    const invalidSort = await app.request(
      '/api/explore/catalog?sort=invalid',
      {},
      { DB: db },
    );
    const invalidType = await app.request(
      '/api/explore/catalog?type=legacy',
      {},
      { DB: db },
    );
    const missingAuth = await app.request(
      '/api/explore/catalog?space_id=space_1',
      {},
      { DB: db },
    );

    deepStrictEqual(catalog.status, 200);
    deepStrictEqual(invalidSort.status, 400);
    deepStrictEqual(invalidType.status, 400);
    deepStrictEqual(missingAuth.status, 401);
    deepStrictEqual(await catalog.json(), {
      items: [],
      total: 0,
      has_more: false,
    });
    deepStrictEqual(catalogCalls.length, 1);
    deepStrictEqual(catalogCalls[0], {
      sort: 'downloads',
      type: 'deployable-app',
      limit: 10,
      offset: 20,
      searchQuery: 'docs',
      category: 'app',
      language: 'typescript',
      license: 'mit',
      since: '2026-02-01T00:00:00.000Z',
      tagsRaw: 'cli,tools',
      certifiedOnly: true,
      spaceId: 'space_1',
      userId: 'acct_1',
      gitObjects: undefined,
      repositoryBaseUrl: 'takos.example.test',
      defaultAppEntries: [],
      accountsInstallations: undefined,
    });
    deepStrictEqual(calls.length, 0);
  } finally {
    exploreCatalogRouteDeps.listCatalogItems = originalList;
    exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap = originalDefaultApps;
    exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig = originalAccounts;
    restoreControl();
    restoreEnv();
  }
});

test('explore catalog clamps a deep offset to the shared max', async () => {
  const originalList = exploreCatalogRouteDeps.listCatalogItems;
  const originalDefaultApps = exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap;
  const originalAccounts = exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig;
  const catalogCalls: Array<{ offset?: number }> = [];
  exploreCatalogRouteDeps.listCatalogItems = ((_, options) => {
    catalogCalls.push(options as { offset?: number });
    return Promise.resolve({ items: [], total: 0, has_more: false });
  }) as typeof exploreCatalogRouteDeps.listCatalogItems;
  exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap = (() =>
    Promise.resolve(
      [],
    )) as typeof exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap;
  exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig = ((
    _,
  ) => null) as typeof exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig;
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const response = await app.request(
      '/api/explore/catalog?offset=999999999',
      {},
      { DB: db },
    );
    deepStrictEqual(response.status, 200);
    deepStrictEqual(catalogCalls.length, 1);
    // Deep offset is clamped to MAX_LIST_OFFSET (10_000) rather than forwarded
    // verbatim as a deep SQL OFFSET scan.
    deepStrictEqual(catalogCalls[0].offset, 10_000);
  } finally {
    exploreCatalogRouteDeps.listCatalogItems = originalList;
    exploreCatalogRouteDeps.resolveDefaultAppDistributionForBootstrap = originalDefaultApps;
    exploreCatalogRouteDeps.resolveCatalogAccountsInstallationsReadConfig = originalAccounts;
  }
});

test('explore catalog rejects an invalid filter (fail-closed, like discovery)', async () => {
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'viewer',
    runId: 'run_1',
    spaceId: 'space_1',
  });
  // An over-length / malformed `language` filter is now rejected with 400 on
  // the catalog endpoint, matching discovery/packages, instead of being
  // silently dropped (the prior copy-pasted catalog helper returned 200).
  const response = await app.request(
    `/api/explore/catalog?language=${'x'.repeat(100)}`,
    {},
    { DB: db },
  );
  deepStrictEqual(response.status, 400);
  const body = await response.json() as {
    error: { code: string; message: string };
  };
  deepStrictEqual(body.error.code, 'INVALID_ARGUMENT');
});

test('explore package routes are served by src/routes/public package catalog', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const originalSearch = explorePackageRouteDeps.searchPackages;
  const originalSuggest = explorePackageRouteDeps.suggestPackages;
  const originalLatest = explorePackageRouteDeps.loadLatestExplorePackage;
  const originalVersions = explorePackageRouteDeps.listExplorePackageVersions;
  const originalReviews = explorePackageRouteDeps.loadExplorePackageReviews;
  const searchCalls: unknown[] = [];
  const suggestCalls: unknown[] = [];
  const latestCalls: unknown[] = [];
  const versionCalls: unknown[] = [];
  const reviewCalls: unknown[] = [];
  explorePackageRouteDeps.searchPackages = ((_, params) => {
    searchCalls.push(params);
    return Promise.resolve({
      packages: [{
        id: 'rel_1',
        name: 'docs',
        app_id: 'docs',
        version: 'v1',
        description: 'Docs app',
        icon: undefined,
        category: 'app',
        tags: ['cli', 'tools'],
        repository: {
          id: 'repo_1',
          name: 'docs',
          description: 'Docs repo',
          stars: 3,
        },
        owner: {
          id: 'acct_owner',
          name: 'Owner',
          username: 'owner',
          avatar_url: null,
        },
        release: {
          id: 'rel_1',
          tag: 'v1',
          published_at: '2026-05-13T00:00:00.000Z',
        },
        asset: {
          id: 'asset_1',
          name: 'bundle.tgz',
          size: 10,
          download_count: 2,
        },
        total_downloads: 2,
        published_at: '2026-05-13T00:00:00.000Z',
        rating_avg: null,
        rating_count: 0,
        publish_status: 'none',
        certified: false,
      }],
      has_more: false,
    });
  }) as typeof explorePackageRouteDeps.searchPackages;
  explorePackageRouteDeps.suggestPackages = ((_, params) => {
    suggestCalls.push(params);
    return Promise.resolve([{
      id: 'rel_1',
      name: 'docs',
      app_id: 'docs',
      version: 'v1',
      description: 'Docs app',
      icon: undefined,
      category: 'app',
      tags: ['cli'],
      repository: {
        id: 'repo_1',
        name: 'docs',
        description: 'Docs repo',
        stars: 3,
      },
      owner: {
        id: 'acct_owner',
        name: 'Owner',
        username: 'owner',
        avatar_url: null,
      },
      release: {
        id: 'rel_1',
        tag: 'v1',
        published_at: '2026-05-13T00:00:00.000Z',
      },
      asset: null,
      total_downloads: 2,
      published_at: '2026-05-13T00:00:00.000Z',
    }]);
  }) as typeof explorePackageRouteDeps.suggestPackages;
  explorePackageRouteDeps.loadLatestExplorePackage = ((_, params) => {
    latestCalls.push(params);
    return Promise.resolve({
      ok: true,
      package: {
        name: 'docs',
        app_id: 'takos-docs',
        version: '1.0.0',
        repository_url: 'https://takos.example.test/git/tako/docs.git',
        description: 'Docs app',
        icon: 'doc',
        repository: {
          id: 'repo_1',
          name: 'docs',
          description: 'Docs repo',
          stars: 3,
        },
        owner: {
          id: 'acct_owner',
          name: 'Owner',
          username: 'tako',
          avatar_url: null,
        },
        release: {
          id: 'rel_1',
          tag: 'v1',
          published_at: '2026-05-13T00:00:00.000Z',
        },
        asset: {
          id: 'asset_1',
          name: 'bundle.tgz',
          size: 10,
          download_count: 2,
        },
        published_at: '2026-05-13T00:00:00.000Z',
        rating_avg: null,
        rating_count: 0,
      },
    });
  }) as typeof explorePackageRouteDeps.loadLatestExplorePackage;
  explorePackageRouteDeps.listExplorePackageVersions = ((_, params) => {
    versionCalls.push(params);
    return Promise.resolve({
      ok: true,
      versions: [{
        tag: 'v1',
        app_id: 'takos-docs',
        version: '1.0.0',
        repository_url: 'https://takos.example.test/git/tako/docs.git',
        is_prerelease: false,
        asset_id: 'asset_1',
        size: 10,
        download_count: 2,
        published_at: '2026-05-13T00:00:00.000Z',
      }],
    });
  }) as typeof explorePackageRouteDeps.listExplorePackageVersions;
  explorePackageRouteDeps.loadExplorePackageReviews = ((_, repoId) => {
    reviewCalls.push(repoId);
    return Promise.resolve({
      ok: true,
      body: {
        repo: { id: 'repo_1', name: 'docs' },
        rating: { rating_avg: null, rating_count: 0 },
        reviews: [],
        viewer_review: null,
        has_more: false,
      },
    });
  }) as typeof explorePackageRouteDeps.loadExplorePackageReviews;
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const list = await app.request(
      '/api/explore/packages?q=docs&sort=popular&category=app&tags=cli,tools&certified_only=true&limit=10&offset=2',
      {},
      { DB: db },
    );
    const suggest = await app.request(
      '/api/explore/packages/suggest?q=doc&category=app&tags=cli&limit=2',
      {},
      { DB: db },
    );
    const emptySuggest = await app.request(
      '/api/explore/packages/suggest',
      {},
      { DB: db },
    );
    const latest = await app.request(
      '/api/explore/packages/tako/docs/latest',
      {},
      { DB: db, ADMIN_DOMAIN: 'takos.example.test' },
    );
    const versions = await app.request(
      '/api/explore/packages/tako/docs/versions',
      {},
      { DB: db, ADMIN_DOMAIN: 'takos.example.test' },
    );
    const reviews = await app.request(
      '/api/explore/packages/by-repo/repo_1/reviews?limit=5&offset=0',
      {},
      { DB: db },
    );
    const invalidCategory = await app.request(
      '/api/explore/packages?category=unknown',
      {},
      { DB: db },
    );
    const invalidTags = await app.request(
      '/api/explore/packages?tags=-bad',
      {},
      { DB: db },
    );
    const listBody = await list.json() as {
      packages: Array<{ id: string; name: string }>;
      has_more: boolean;
    };
    const suggestBody = await suggest.json() as {
      packages: Array<{ id: string; name: string }>;
    };
    const emptySuggestBody = await emptySuggest.json() as {
      packages: unknown[];
    };
    const latestBody = await latest.json() as {
      package: { app_id: string; repository_url: string };
    };
    const versionsBody = await versions.json() as {
      versions: Array<{
        tag: string;
        app_id: string;
        version: string;
        repository_url: string;
        is_prerelease: boolean;
        asset_id: string | null;
        size: number | null;
        download_count: number;
        published_at: string | null;
      }>;
    };
    const reviewsBody = await reviews.json() as {
      repo: { id: string; name: string };
      rating: { rating_avg: number | null; rating_count: number };
      reviews: unknown[];
      viewer_review: null;
      has_more: boolean;
    };

    deepStrictEqual(list.status, 200);
    deepStrictEqual(suggest.status, 200);
    deepStrictEqual(emptySuggest.status, 200);
    deepStrictEqual(latest.status, 200);
    deepStrictEqual(versions.status, 200);
    deepStrictEqual(reviews.status, 200);
    deepStrictEqual(invalidCategory.status, 400);
    deepStrictEqual(invalidTags.status, 400);
    deepStrictEqual(listBody.packages.map((item) => item.id), ['rel_1']);
    deepStrictEqual(suggestBody.packages.map((item) => item.name), ['docs']);
    deepStrictEqual(emptySuggestBody.packages, []);
    deepStrictEqual(latestBody.package.app_id, 'takos-docs');
    deepStrictEqual(
      latestBody.package.repository_url,
      'https://takos.example.test/git/tako/docs.git',
    );
    deepStrictEqual(versionsBody.versions, [{
      tag: 'v1',
      app_id: 'takos-docs',
      version: '1.0.0',
      repository_url: 'https://takos.example.test/git/tako/docs.git',
      is_prerelease: false,
      asset_id: 'asset_1',
      size: 10,
      download_count: 2,
      published_at: '2026-05-13T00:00:00.000Z',
    }]);
    deepStrictEqual(reviewsBody, {
      repo: { id: 'repo_1', name: 'docs' },
      rating: { rating_avg: null, rating_count: 0 },
      reviews: [],
      viewer_review: null,
      has_more: false,
    });
    deepStrictEqual(searchCalls.length, 1);
    deepStrictEqual(searchCalls[0], {
      searchQuery: 'docs',
      sortParamRaw: 'popular',
      limit: 10,
      offset: 2,
      category: 'app',
      tags: ['cli', 'tools'],
      certifiedOnly: true,
    });
    deepStrictEqual(suggestCalls.length, 1);
    deepStrictEqual(suggestCalls[0], {
      query: 'doc',
      limit: 2,
      category: 'app',
      tags: ['cli'],
    });
    deepStrictEqual(latestCalls, [{
      username: 'tako',
      repoName: 'docs',
      gitObjects: undefined,
      repositoryBaseUrl: 'takos.example.test',
    }]);
    deepStrictEqual(versionCalls, [{
      username: 'tako',
      repoName: 'docs',
      gitObjects: undefined,
      repositoryBaseUrl: 'takos.example.test',
    }]);
    deepStrictEqual(reviewCalls, ['repo_1']);
    deepStrictEqual(calls.length, 0);
  } finally {
    explorePackageRouteDeps.searchPackages = originalSearch;
    explorePackageRouteDeps.suggestPackages = originalSuggest;
    explorePackageRouteDeps.loadLatestExplorePackage = originalLatest;
    explorePackageRouteDeps.listExplorePackageVersions = originalVersions;
    explorePackageRouteDeps.loadExplorePackageReviews = originalReviews;
    restoreControl();
  }
});

test('explore users and repo routes are served by src/routes/public discovery service', async () => {
  const calls: ExternalFetchCall[] = [];
  const restoreControl = stubExternalFetch(calls, [
    Response.json({ proxied: false }),
  ]);
  const restoreEnv = setEnv({
    TAKOS_INTERNAL_API_SECRET: 'trusted-proxy-secret',
  });
  const originalList = exploreDiscoveryRouteDeps.listExploreRepos;
  const originalTrending = exploreDiscoveryRouteDeps.listTrendingRepos;
  const originalNew = exploreDiscoveryRouteDeps.listNewRepos;
  const originalRecent = exploreDiscoveryRouteDeps.listRecentRepos;
  const originalUsers = exploreDiscoveryRouteDeps.queryExploreUsers;
  const originalUser = exploreDiscoveryRouteDeps.queryExploreUser;
  const originalRepoByName = exploreDiscoveryRouteDeps.queryExploreRepoByName;
  const originalRepoById = exploreDiscoveryRouteDeps.queryExploreRepoById;
  const listCalls: unknown[] = [];
  const trendingCalls: unknown[] = [];
  const newCalls: unknown[] = [];
  const recentCalls: unknown[] = [];
  const userListCalls: unknown[] = [];
  const userDetailCalls: unknown[] = [];
  const repoByNameCalls: unknown[] = [];
  const repoByIdCalls: unknown[] = [];
  const repoDetail = {
    repository: {
      id: 'repo_1',
      name: 'docs',
      description: 'Docs repo',
      visibility: 'public',
      default_branch: 'main',
      stars: 3,
      forks: 1,
      created_at: '2026-05-13T00:00:00.000Z',
      updated_at: '2026-05-13T00:01:00.000Z',
    },
    space: { id: 'acct_owner', name: 'Owner' },
    owner: {
      id: 'acct_owner',
      name: 'Owner',
      username: 'tako',
      avatar_url: null,
    },
    is_starred: true,
  };
  exploreDiscoveryRouteDeps.listExploreRepos = ((_, options) => {
    listCalls.push(options);
    return Promise.resolve({ repos: [], total: 0, has_more: false });
  }) as typeof exploreDiscoveryRouteDeps.listExploreRepos;
  exploreDiscoveryRouteDeps.listTrendingRepos = ((_, options) => {
    trendingCalls.push(options);
    return Promise.resolve({ repos: [], total: 0, has_more: false });
  }) as typeof exploreDiscoveryRouteDeps.listTrendingRepos;
  exploreDiscoveryRouteDeps.listNewRepos = ((_, options) => {
    newCalls.push(options);
    return Promise.resolve({ repos: [], total: 0, has_more: false });
  }) as typeof exploreDiscoveryRouteDeps.listNewRepos;
  exploreDiscoveryRouteDeps.listRecentRepos = ((_, options) => {
    recentCalls.push(options);
    return Promise.resolve({ repos: [], total: 0, has_more: false });
  }) as typeof exploreDiscoveryRouteDeps.listRecentRepos;
  exploreDiscoveryRouteDeps.queryExploreUsers = ((_, query) => {
    userListCalls.push(Object.fromEntries(query));
    return Promise.resolve({
      users: [{
        username: 'tako',
        name: 'Tako',
        avatar_url: null,
        public_repo_count: 1,
      }],
      has_more: false,
    });
  }) as typeof exploreDiscoveryRouteDeps.queryExploreUsers;
  exploreDiscoveryRouteDeps.queryExploreUser = ((_, username, userId) => {
    userDetailCalls.push({ username, userId });
    return Promise.resolve({
      user: {
        username: 'tako',
        name: 'Tako',
        avatar_url: null,
        bio: 'Docs',
      },
      repositories: [{
        id: 'repo_1',
        name: 'docs',
        description: 'Docs repo',
        visibility: 'public',
        stars: 3,
        forks: 1,
        created_at: '2026-05-13T00:00:00.000Z',
        updated_at: '2026-05-13T00:01:00.000Z',
        space: { slug: 'tako', name: 'Tako' },
        owner: { username: 'tako', name: 'Tako', avatar_url: null },
        is_starred: true,
      }],
    });
  }) as typeof exploreDiscoveryRouteDeps.queryExploreUser;
  exploreDiscoveryRouteDeps.queryExploreRepoByName = ((
    _,
    username,
    repoName,
    userId,
  ) => {
    repoByNameCalls.push({ username, repoName, userId });
    return Promise.resolve(repoDetail);
  }) as typeof exploreDiscoveryRouteDeps.queryExploreRepoByName;
  exploreDiscoveryRouteDeps.queryExploreRepoById = ((_, repoId, userId) => {
    repoByIdCalls.push({ repoId, userId });
    return Promise.resolve(repoDetail);
  }) as typeof exploreDiscoveryRouteDeps.queryExploreRepoById;
  try {
    const db = fakeApiDb({
      actorAccountId: 'acct_1',
      membershipRole: 'viewer',
      runId: 'run_1',
      spaceId: 'space_1',
    });
    const authHeaders = {
      'x-takos-internal-secret': 'trusted-proxy-secret',
      'x-takos-account-id': 'acct_1',
    };
    const users = await app.request(
      '/api/explore/users?q=tak&limit=5&offset=1',
      {},
      { DB: db },
    );
    const user = await app.request(
      '/api/explore/users/tako',
      { headers: authHeaders },
      { DB: db },
    );
    const repos = await app.request(
      '/api/explore/repos?q=docs&sort=updated&order=asc&category=app&language=typescript&license=mit&since=2026-02-01&limit=10&offset=2',
      { headers: authHeaders },
      { DB: db },
    );
    const trending = await app.request(
      '/api/explore/repos/trending?category=app&limit=3',
      { headers: authHeaders },
      { DB: db },
    );
    const newest = await app.request(
      '/api/explore/repos/new?language=typescript',
      { headers: authHeaders },
      { DB: db },
    );
    const recent = await app.request(
      '/api/explore/repos/recent?license=mit',
      { headers: authHeaders },
      { DB: db },
    );
    const byName = await app.request(
      '/api/explore/repos/by-name/tako/docs',
      { headers: authHeaders },
      { DB: db },
    );
    const byId = await app.request(
      '/api/explore/repos/repo_1',
      { headers: authHeaders },
      { DB: db },
    );
    const invalidCategory = await app.request(
      '/api/explore/repos?category=unknown',
      {},
      { DB: db },
    );
    const invalidSince = await app.request(
      '/api/explore/repos/recent?since=20260513',
      {},
      { DB: db },
    );

    deepStrictEqual(users.status, 200);
    deepStrictEqual(user.status, 200);
    deepStrictEqual(repos.status, 200);
    deepStrictEqual(trending.status, 200);
    deepStrictEqual(newest.status, 200);
    deepStrictEqual(recent.status, 200);
    deepStrictEqual(byName.status, 200);
    deepStrictEqual(byId.status, 200);
    deepStrictEqual(invalidCategory.status, 400);
    deepStrictEqual(invalidSince.status, 400);
    deepStrictEqual(await users.json(), {
      users: [{
        username: 'tako',
        name: 'Tako',
        avatar_url: null,
        public_repo_count: 1,
      }],
      has_more: false,
    });
    const userBody = await user.json() as {
      user: { username: string };
    };
    deepStrictEqual(userBody.user.username, 'tako');
    deepStrictEqual(await byName.json(), repoDetail);
    deepStrictEqual(await byId.json(), repoDetail);
    deepStrictEqual(userListCalls, [{ q: 'tak', limit: '5', offset: '1' }]);
    deepStrictEqual(userDetailCalls, [{ username: 'tako', userId: 'acct_1' }]);
    deepStrictEqual(listCalls, [{
      sort: 'updated',
      order: 'asc',
      limit: 10,
      offset: 2,
      searchQuery: 'docs',
      category: 'app',
      language: 'typescript',
      license: 'mit',
      since: '2026-02-01T00:00:00.000Z',
      userId: 'acct_1',
    }]);
    deepStrictEqual(trendingCalls, [{
      limit: 3,
      offset: 0,
      category: 'app',
      language: undefined,
      license: undefined,
      since: undefined,
      userId: 'acct_1',
    }]);
    deepStrictEqual(newCalls, [{
      limit: 20,
      offset: 0,
      category: undefined,
      language: 'typescript',
      license: undefined,
      since: undefined,
      userId: 'acct_1',
    }]);
    deepStrictEqual(recentCalls, [{
      limit: 20,
      offset: 0,
      category: undefined,
      language: undefined,
      license: 'mit',
      since: undefined,
      userId: 'acct_1',
    }]);
    deepStrictEqual(repoByNameCalls, [{
      username: 'tako',
      repoName: 'docs',
      userId: 'acct_1',
    }]);
    deepStrictEqual(repoByIdCalls, [{ repoId: 'repo_1', userId: 'acct_1' }]);
    deepStrictEqual(calls.length, 0);
  } finally {
    exploreDiscoveryRouteDeps.listExploreRepos = originalList;
    exploreDiscoveryRouteDeps.listTrendingRepos = originalTrending;
    exploreDiscoveryRouteDeps.listNewRepos = originalNew;
    exploreDiscoveryRouteDeps.listRecentRepos = originalRecent;
    exploreDiscoveryRouteDeps.queryExploreUsers = originalUsers;
    exploreDiscoveryRouteDeps.queryExploreUser = originalUser;
    exploreDiscoveryRouteDeps.queryExploreRepoByName = originalRepoByName;
    exploreDiscoveryRouteDeps.queryExploreRepoById = originalRepoById;
    restoreControl();
    restoreEnv();
  }
});

test('explore suggest routes are served by src/routes/public catalog read model', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    Response.json({ proxied: true }),
  ]);
  try {
    const db = fakeExploreSuggestDb();
    const suggest = await app.request(
      '/api/explore/suggest?q=doc&limit=1',
      {},
      { DB: db },
    );
    const catalogSuggest = await app.request(
      '/api/explore/catalog/suggest?q=doc',
      {},
      { DB: db },
    );
    const empty = await app.request(
      '/api/explore/suggest',
      {},
      { DB: db },
    );
    const body = await suggest.json() as {
      users: Array<{ username: string; name: string; avatar_url: string }>;
      repos: Array<{
        id: string;
        name: string;
        owner: { username: string; name: string; avatar_url: string };
      }>;
    };
    const catalogBody = await catalogSuggest.json() as {
      users: unknown[];
      repos: unknown[];
    };
    const emptyBody = await empty.json() as {
      users: unknown[];
      repos: unknown[];
    };

    deepStrictEqual(suggest.status, 200);
    deepStrictEqual(catalogSuggest.status, 200);
    deepStrictEqual(empty.status, 200);
    deepStrictEqual(body.users, [{
      username: 'docs',
      name: 'Docs User',
      avatar_url: 'https://example.test/avatar.png',
    }]);
    deepStrictEqual(
      body.repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        owner: repo.owner,
      })),
      [{
        id: 'repo_1',
        name: 'docs-app',
        owner: {
          username: 'docs',
          name: 'Docs User',
          avatar_url: 'https://example.test/avatar.png',
        },
      }],
    );
    deepStrictEqual(catalogBody.repos.length, 1);
    deepStrictEqual(emptyBody, { users: [], repos: [] });
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('setup route family requires in-process control bindings', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, [
    Response.json({ setup_completed: false }),
    Response.json({ success: true, username: 'tako' }),
    Response.json({ available: true }),
  ]);
  try {
    const status = await app.request('/api/setup/status?source=web', {
      headers: {
        authorization: 'Bearer takpat_direct',
        'x-takos-internal-secret': 'client-controlled',
        'x-takos-account-id': 'client-controlled',
      },
    });
    const complete = await app.request('/api/setup/complete', {
      method: 'POST',
      headers: {
        authorization: 'Bearer takpat_direct',
        'content-type': 'application/json',
        'x-takos-internal-secret': 'client-controlled',
      },
      body: JSON.stringify({ username: 'tako' }),
    });
    const checkUsername = await app.request('/api/setup/check-username', {
      method: 'POST',
      headers: {
        authorization: 'Bearer takpat_direct',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ username: 'tako' }),
    });

    await assertControlBindingRequired(status);
    await assertControlBindingRequired(complete);
    await assertControlBindingRequired(checkUsername);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('retired billing routes return 410 and are not proxied', async () => {
  const calls: ExternalFetchCall[] = [];
  const restore = stubExternalFetch(calls, { unreachable: true });
  try {
    const portal = await app.request('/api/billing/portal', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: '__Host-tp_session=sess_1',
      },
      body: JSON.stringify({ return_url: '/settings/billing' }),
    });
    const webhook = await app.request('/api/billing/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 'sig_1',
        'x-takos-auth-proxy-secret': 'client-controlled',
      },
      body: JSON.stringify({ id: 'evt_1' }),
    });
    const internal = await app.request(
      '/api/internal/v1/billing/usage-events',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-auth-proxy-secret': 'client-controlled',
        },
        body: JSON.stringify({ id: 'usage_1' }),
      },
    );

    deepStrictEqual(portal.status, 410);
    deepStrictEqual(webhook.status, 410);
    deepStrictEqual(internal.status, 410);
    const body = await portal.json() as {
      error: { code: string; message: string };
    };
    deepStrictEqual(body.error.code, 'GONE');
    deepStrictEqual(portal.headers.get('location'), null);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('raw actor headers are rejected without a trusted proxy marker', async () => {
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  try {
    const response = await app.request(TAKOS_PUBLIC_API_PATHS.spaces, {
      headers: { 'x-takos-account-id': 'acct_1' },
    });
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 401);
    deepStrictEqual(body.error.code, 'UNAUTHORIZED');
    deepStrictEqual(body.error.message, 'authentication required');
  } finally {
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  }
});

test('direct bearer credentials are verified in-process before forwarding', async () => {
  const authCalls: AuthValidationCall[] = [];
  const calls: SignedCall[] = [];
  const restore = stubAuthVerifiedTakosumiFetch(authCalls, calls, {
    spaces: [],
  });
  const env = directAuthEnv();
  try {
    const response = await app.request(
      TAKOS_PUBLIC_API_PATHS.spaces,
      {
        headers: {
          authorization: 'Bearer takpat_direct',
          'user-agent': 'api-test',
        },
      },
      env,
    );
    const actor = actorFromSignedHeaders(calls[0].headers);

    deepStrictEqual(response.status, 200);
    deepStrictEqual(authCalls.length, 1);
    deepStrictEqual(authCalls[0].token, 'takpat_direct');
    deepStrictEqual(
      new URL(calls[0].url).pathname,
      TAKOSUMI_INTERNAL_PATHS.spaces,
    );
    deepStrictEqual(actor.actorAccountId, 'acct_verified');
    deepStrictEqual(actor.roles, ['member']);
    deepStrictEqual(actor.spaceId, undefined);
    deepStrictEqual(typeof actor.requestId, 'string');
  } finally {
    restore();
  }
});

for (
  const [name, credential] of [
    ['tak_oat', 'tak_oat_direct'],
    ['tak_pat', 'tak_pat_direct'],
  ] as const
) {
  test(`retired ${name} bearer credentials are not sent to the direct verifier`, async () => {
    const authCalls: AuthValidationCall[] = [];
    const calls: SignedCall[] = [];
    const restore = stubAuthVerifiedTakosumiFetch(authCalls, calls, {
      spaces: [],
    });
    try {
      const response = await app.request(
        TAKOS_PUBLIC_API_PATHS.spaces,
        {
          headers: { authorization: `Bearer ${credential}` },
        },
      );
      const body = await response.json() as {
        error: { code: string; message: string };
      };

      deepStrictEqual(response.status, 401);
      deepStrictEqual(body.error.code, 'UNAUTHORIZED');
      deepStrictEqual(body.error.message, 'authentication required');
      deepStrictEqual(authCalls.length, 0);
      deepStrictEqual(calls.length, 0);
    } finally {
      restore();
    }
  });
}

test('Git Smart HTTP Basic PAT is normalized through auth verifier', async () => {
  const authCalls: AuthValidationCall[] = [];
  const calls: SignedCall[] = [];
  const restore = stubAuthVerifiedGitFetch(
    authCalls,
    calls,
    '# service=git-upload-pack\n',
  );
  const env = directAuthEnv();
  try {
    const response = await app.request(
      '/git/space_1/repo.git/info/refs?service=git-upload-pack',
      {
        headers: {
          authorization: `Basic ${btoa('git:takpat_git')}`,
        },
      },
      env,
    );
    const actor = actorFromSignedHeaders(calls[0].headers);

    deepStrictEqual(response.status, 200);
    deepStrictEqual(authCalls.length, 1);
    deepStrictEqual(authCalls[0].token, 'takpat_git');
    deepStrictEqual(
      new URL(calls[0].url).pathname,
      '/git/space_1/repo.git/info/refs',
    );
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.repo.read',
    );
    deepStrictEqual(actor.actorAccountId, 'acct_verified');
    deepStrictEqual(actor.spaceId, 'space_1');
  } finally {
    restore();
  }
});

test('direct credential verifier rejection returns common auth error', async () => {
  const authCalls: AuthValidationCall[] = [];
  const calls: SignedCall[] = [];
  const restore = stubAuthVerifiedTakosumiFetch(
    authCalls,
    calls,
    { spaces: [] },
    200,
    401,
  );
  const env = directAuthEnv();
  try {
    const response = await app.request(
      TAKOS_PUBLIC_API_PATHS.spaces,
      {
        headers: { authorization: 'Bearer takpat_expired' },
      },
      env,
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 401);
    deepStrictEqual(body.error.code, 'UNAUTHORIZED');
    deepStrictEqual(body.error.message, 'Invalid or expired bearer token');
    deepStrictEqual(authCalls.length, 1);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('local internal proxy flag allows unauthenticated actor headers', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFlag = getEnv(
    'TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS',
  );
  const originalSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  const restore = stubTakosumiFetch(calls, { spaces: [] });
  setEnv('TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS', 'true');
  // The dev escape hatch is only honored when there is no real auth posture,
  // so the internal secret must be unset for this path to apply.
  deleteEnv('TAKOS_INTERNAL_API_SECRET');
  try {
    const response = await app.request(
      TAKOS_PUBLIC_API_PATHS.spaces,
      { headers: { 'x-takos-account-id': 'acct_1' } },
    );

    deepStrictEqual(response.status, 200);
    deepStrictEqual(
      new URL(calls[0].url).pathname,
      TAKOSUMI_INTERNAL_PATHS.spaces,
    );
  } finally {
    restore();
    restoreEnv('TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS', originalFlag);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalSecret);
  }
});

test('unauthenticated actor header flag is ignored when an internal secret is configured', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFlag = getEnv(
    'TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS',
  );
  const originalSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  const restore = stubTakosumiFetch(calls, { spaces: [] });
  // Flag is set AND a real internal-secret auth posture exists: the dev-only
  // raw-header escape hatch must fail closed so a client cannot assert an
  // arbitrary account id / roles without a verified credential.
  setEnv('TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS', 'true');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  try {
    const response = await app.request(
      TAKOS_PUBLIC_API_PATHS.spaces,
      { headers: { 'x-takos-account-id': 'acct_1', 'x-takos-roles': 'admin' } },
    );

    deepStrictEqual(response.status, 401);
    // No upstream call should have been made with the spoofed actor.
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
    restoreEnv('TAKOS_API_ALLOW_UNAUTHENTICATED_ACTOR_HEADERS', originalFlag);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalSecret);
  }
});

test('AppInstallation binding placeholder accepts trusted bindings', async () => {
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  try {
    const response = await app.request(
      '/_takosumi/app-installation-bindings',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'client-controlled',
        },
        body: JSON.stringify({
          installationId: 'inst_1',
          appId: 'takos.chat',
          spaceId: 'space_1',
          bindings: [{
            name: 'auth',
            kind: 'identity.oidc@v1',
            configRef: 'config://inst_1/auth',
            secretRefs: ['secret://inst_1/auth/client-secret'],
          }, {
            name: 'bootstrap',
            type: 'install-launch-token@v1',
            config_ref: 'config://inst_1/bootstrap',
            secret_refs: [],
          }],
        }),
      },
    );
    const body = await response.json() as {
      accepted: boolean;
      installationId: string;
      appId: string;
      spaceId: string;
      bindings: Array<{ name: string; kind: string; config_ref: string }>;
    };

    deepStrictEqual(response.status, 202);
    deepStrictEqual(body.accepted, true);
    deepStrictEqual(body.installationId, 'inst_1');
    deepStrictEqual(body.appId, 'takos.chat');
    deepStrictEqual(body.spaceId, 'space_1');
    deepStrictEqual(body.bindings.map((binding) => binding.name), [
      'auth',
      'bootstrap',
    ]);
    deepStrictEqual(body.bindings[0].kind, 'identity.oidc@v1');
    deepStrictEqual(body.bindings[0].config_ref, 'config://inst_1/auth');
  } finally {
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  }
});

test('AppInstallation binding placeholder rejects service import binding kind', async () => {
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  try {
    const response = await app.request(
      '/_takosumi/app-installation-bindings',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
        },
        body: JSON.stringify({
          installationId: 'inst_1',
          appId: 'takos.chat',
          spaceId: 'space_1',
          bindings: [{
            name: 'account-auth',
            type: 'service.import@v1',
            config_ref: 'config://inst_1/account-auth',
            secret_refs: [],
          }],
        }),
      },
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 400);
    deepStrictEqual(body.error.code, 'INVALID_ARGUMENT');
    deepStrictEqual(body.error.message, 'bindings[0].kind is invalid');
  } finally {
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  }
});

test('AppInstallation binding placeholder rejects untrusted actor headers', async () => {
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  try {
    const response = await app.request(
      '/_takosumi/app-installation-bindings',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-account-id': 'client-controlled',
        },
        body: JSON.stringify({
          installationId: 'inst_1',
          appId: 'takos.chat',
          spaceId: 'space_1',
          bindings: [],
        }),
      },
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 401);
    deepStrictEqual(body.error.code, 'UNAUTHORIZED');
    deepStrictEqual(body.error.message, 'trusted service authentication required');
  } finally {
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  }
});

test('AppInstallation binding placeholder validates binding catalog', async () => {
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  try {
    const response = await app.request(
      '/_takosumi/app-installation-bindings',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
        },
        body: JSON.stringify({
          installationId: 'inst_1',
          appId: 'takos.chat',
          spaceId: 'space_1',
          bindings: [{
            name: 'db',
            kind: 'database.mysql@v1',
            configRef: 'config://inst_1/db',
          }],
        }),
      },
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 400);
    deepStrictEqual(body.error.code, 'INVALID_ARGUMENT');
    ok(body.error.message, 'bindings[0].kind');
  } finally {
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  }
});

test('Takosumi launch consumes opaque GET launch_token and requires in-process session bindings', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const redirectUri = 'https://takos.example.test/_takosumi/launch';
  const restore = stubTakosumiAccountsFetch(
    calls,
    {
      consumed: true,
      installation_id: 'inst_opaque',
      account_id: 'acct_1',
      space_id: 'space_1',
      app_id: 'takos.chat',
      subject: 'tsub_pairwise_opaque',
      role: 'owner',
    },
    200,
    {
      opaqueLaunch: {
        installationId: 'inst_opaque',
        redirectUri,
        issuerUrl: 'https://accounts.example.test',
      },
    },
  );
  try {
    const response = await app.request(
      `https://takos.example.test/_takosumi/launch?launch_token=${encodeURIComponent('opaque-get-token')}`,
    );

    await assertControlBindingRequired(response);
    deepStrictEqual(calls.length, 1);
    deepStrictEqual(
      new URL(calls[0].url).pathname,
      '/v1/installations/inst_opaque/launch-token/consume',
    );
    deepStrictEqual(calls[0].method, 'POST');
    deepStrictEqual(calls[0].body, {
      token: 'opaque-get-token',
      redirect_uri: redirectUri,
    });
  } finally {
    restore();
  }
});

test('Takosumi launch accepts opaque POST body launch_token and requires in-process session bindings', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const redirectUri = 'https://takos.example.test/_takosumi/launch';
  const restore = stubTakosumiAccountsFetch(
    calls,
    {
      consumed: true,
      installation_id: 'inst_opaque_post',
      account_id: 'acct_1',
      space_id: 'space_1',
      app_id: 'takos.chat',
      subject: 'tsub_pairwise_opaque_post',
      role: 'owner',
    },
    200,
    {
      opaqueLaunch: {
        installationId: 'inst_opaque_post',
        redirectUri,
      },
    },
  );
  try {
    const launchTokenResponse = await app.request(
      'https://takos.example.test/_takosumi/launch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ launch_token: 'opaque-post-launch-token' }),
      },
    );
    await assertControlBindingRequired(launchTokenResponse);
    deepStrictEqual(calls.length, 1);
    deepStrictEqual(calls[0].body, {
      token: 'opaque-post-launch-token',
      redirect_uri: redirectUri,
    });
  } finally {
    restore();
  }
});

test('Takosumi launch rejects legacy token parameter', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiAccountsFetch(calls, { unexpected: true });
  try {
    const queryResponse = await app.request(
      'https://takos.example.test/_takosumi/launch?token=legacy-jws',
    );
    const postResponse = await app.request(
      'https://takos.example.test/_takosumi/launch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'legacy-jws' }),
      },
    );

    deepStrictEqual(queryResponse.status, 400);
    deepStrictEqual(postResponse.status, 400);
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('Takosumi launch maps opaque token replay failures', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const redirectUri = 'https://takos.example.test/_takosumi/launch';
  const restore = stubTakosumiAccountsFetch(
    calls,
    {
      error: 'launch_token_replayed',
    },
    410,
    {
      opaqueLaunch: {
        installationId: 'inst_opaque_replay',
        redirectUri,
      },
    },
  );
  try {
    const response = await app.request(
      'https://takos.example.test/_takosumi/launch?launch_token=opaque-replay',
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 410);
    deepStrictEqual(body.error.code, 'FAILED_PRECONDITION');
    deepStrictEqual(body.error.message, 'launch_token_replayed');
    deepStrictEqual(calls.length, 1);
    deepStrictEqual(calls[0].body, {
      token: 'opaque-replay',
      redirect_uri: redirectUri,
    });
  } finally {
    restore();
  }
});

test('Takosumi launch requires opaque config for launch_token', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubTakosumiAccountsFetch(calls, { unexpected: true });
  setEnv('INSTALL_LAUNCH_INSTALLATION_ID', 'inst_missing_redirect');
  try {
    const response = await app.request(
      'https://takos.example.test/_takosumi/launch?launch_token=opaque-missing-config',
    );
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 500);
    deepStrictEqual(body.error.code, 'INTERNAL_ERROR');
    ok(body.error.message, 'opaque launch token config');
    deepStrictEqual(calls.length, 0);
  } finally {
    restore();
  }
});

test('runtime list forwarding preserves normalized space query', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubRuntimeFetch(calls, { items: [] });
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'viewer',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const response = await app.request(
      '/api/resources?space_id=space_1&type=kv',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );

    const url = new URL(calls[0].url);
    deepStrictEqual(response.status, 200);
    deepStrictEqual(url.pathname, '/api/internal/v1/runtime/resources');
    deepStrictEqual(url.searchParams.get('spaceId'), 'space_1');
    deepStrictEqual(url.searchParams.get('space_id'), null);
    deepStrictEqual(url.searchParams.get('type'), 'kv');
  } finally {
    restore();
  }
});

test('space-scoped services and sessions alias to runtime base routes', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubRuntimeFetch(calls, { items: [] });
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'editor',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const servicesResponse = await app.request('/api/spaces/space_1/services', {
      headers: {
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
    }, { DB: db });
    const sessionsResponse = await app.request('/api/spaces/space_1/sessions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
      body: JSON.stringify({ payload: { kind: 'shell' } }),
    }, { DB: db });

    deepStrictEqual(servicesResponse.status, 200);
    deepStrictEqual(sessionsResponse.status, 200);
    deepStrictEqual(
      new URL(calls[0].url).pathname,
      '/api/internal/v1/runtime/services',
    );
    deepStrictEqual(new URL(calls[0].url).searchParams.get('spaceId'), 'space_1');
    deepStrictEqual(
      new URL(calls[1].url).pathname,
      '/api/internal/v1/runtime/sessions',
    );
    deepStrictEqual((calls[1].body as Record<string, unknown>).spaceId, 'space_1');
  } finally {
    restore();
  }
});

test('nested runtime route families forward to Takosumi runtime', async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const restore = stubRuntimeFetch(calls, { ok: true });
  const dbSpace1 = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'editor',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  const dbSpace2 = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'editor',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_2',
  });
  try {
    const cases = [
      ['/api/services/svc_1/env?space_id=space_1', 'PATCH', {
        vars: { A: '1' },
      }, dbSpace1],
      [
        '/api/services/svc_1/deployments/dep_1?spaceId=space_1',
        'GET',
        null,
        dbSpace1,
      ],
      ['/api/resources/res_1/d1/query?space_id=space_1', 'POST', {
        sql: 'select 1',
      }, dbSpace1],
      [
        '/api/resources/res_1/r2/objects?space_id=space_1',
        'GET',
        null,
        dbSpace1,
      ],
      ['/api/spaces/space_2/services/svc_2/settings', 'PATCH', {
        compatibility_date: '2026-01-01',
      }, dbSpace2],
    ] as const;

    for (const [path, method, body, db] of cases) {
      const response = await app.request(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: body ? JSON.stringify(body) : undefined,
      }, { DB: db });
      deepStrictEqual(response.status, 200);
    }

    deepStrictEqual(
      calls.map((call) => [
        new URL(call.url).pathname,
        new URL(call.url).searchParams.get('spaceId'),
        call.method,
        call.body,
      ]),
      [
        [
          '/api/internal/v1/runtime/services/svc_1/env',
          'space_1',
          'PATCH',
          { vars: { A: '1' } },
        ],
        [
          '/api/internal/v1/runtime/services/svc_1/deployments/dep_1',
          'space_1',
          'GET',
          {},
        ],
        [
          '/api/internal/v1/runtime/resources/res_1/d1/query',
          'space_1',
          'POST',
          { sql: 'select 1' },
        ],
        [
          '/api/internal/v1/runtime/resources/res_1/r2/objects',
          'space_1',
          'GET',
          {},
        ],
        [
          '/api/internal/v1/runtime/services/svc_2/settings',
          'space_2',
          'PATCH',
          { compatibility_date: '2026-01-01' },
        ],
      ],
    );
  } finally {
    restore();
  }
});

test('Git hosting public path signs and proxies to takos-git', async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restore = stubGitFetch(calls, '# service=git-upload-pack\n');
  try {
    const response = await app.request(
      '/space_1/repo.git/info/refs?service=git-upload-pack',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
    );

    deepStrictEqual(response.status, 200);
    deepStrictEqual(
      calls[0].url,
      'https://git.internal/space_1/repo.git/info/refs?service=git-upload-pack',
    );
    deepStrictEqual(calls[0].method, 'GET');
    deepStrictEqual(calls[0].headers.get('x-takosumi-caller'), 'takos-worker');
    deepStrictEqual(calls[0].headers.get('x-takosumi-audience'), 'takos-git');
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.repo.read',
    );
  } finally {
    restore();
  }
});

test('Git repository detail public path signs and proxies to takos-git', async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restore = stubGitFetch(
    calls,
    JSON.stringify({
      id: 'repo_1',
      defaultBranch: 'main',
      refs: [],
    }),
  );
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'viewer',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const detail = await app.request(
      '/api/repositories/repo_1?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const forbidden = await app.request(
      '/api/repositories/repo_1?spaceId=space_other',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const missingSpace = await app.request(
      '/api/repositories/repo_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );

    deepStrictEqual(detail.status, 200);
    deepStrictEqual(forbidden.status, 403);
    deepStrictEqual(missingSpace.status, 400);
    deepStrictEqual(
      calls.map((call) => [new URL(call.url).pathname, call.method]),
      [['/internal/repositories/repo_1', 'GET']],
    );
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.repo.read',
    );
  } finally {
    restore();
  }
});

test('Git pull request public paths sign and proxy to takos-git', async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restore = stubGitFetch(calls, JSON.stringify({ pullRequests: [] }));
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'editor',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const list = await app.request(
      '/api/repositories/repo_1/pull-requests?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const create = await app.request(
      '/api/repositories/repo_1/pull-requests',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({
          title: 'Add docs',
          headBranch: 'feature/docs',
          baseBranch: 'main',
          space_id: 'space_1',
        }),
      },
      { DB: db },
    );
    const update = await app.request(
      '/api/repositories/repo_1/pull-requests/1',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({
          title: 'Add docs and examples',
          space_id: 'space_1',
        }),
      },
      { DB: db },
    );
    const comment = await app.request(
      '/api/repositories/repo_1/pull-requests/1/comments',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ body: 'Looks good', space_id: 'space_1' }),
      },
      { DB: db },
    );
    const review = await app.request(
      '/api/repositories/repo_1/pull-requests/1/reviews',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({
          status: 'approved',
          body: 'Approved',
          space_id: 'space_1',
        }),
      },
      { DB: db },
    );
    const merge = await app.request(
      '/api/repositories/repo_1/pull-requests/1/merge',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ space_id: 'space_1' }),
      },
      { DB: db },
    );

    deepStrictEqual(list.status, 200);
    deepStrictEqual(create.status, 200);
    deepStrictEqual(update.status, 200);
    deepStrictEqual(comment.status, 200);
    deepStrictEqual(review.status, 200);
    deepStrictEqual(merge.status, 200);
    deepStrictEqual(
      calls.map((call) => [new URL(call.url).pathname, call.method]),
      [
        ['/internal/repositories/repo_1/pull-requests', 'GET'],
        ['/internal/repositories/repo_1/pull-requests', 'POST'],
        ['/internal/repositories/repo_1/pull-requests/1', 'PATCH'],
        ['/internal/repositories/repo_1/pull-requests/1/comments', 'POST'],
        ['/internal/repositories/repo_1/pull-requests/1/reviews', 'POST'],
        ['/internal/repositories/repo_1/pull-requests/1/merge', 'POST'],
      ],
    );
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.pr.read',
    );
    deepStrictEqual(
      calls[1].headers.get('x-takosumi-capabilities'),
      'git.pr.write',
    );
    deepStrictEqual(
      calls[2].headers.get('x-takosumi-capabilities'),
      'git.pr.write',
    );
    deepStrictEqual(
      calls[3].headers.get('x-takosumi-capabilities'),
      'git.pr.write',
    );
    deepStrictEqual(
      calls[4].headers.get('x-takosumi-capabilities'),
      'git.pr.write',
    );
    deepStrictEqual(
      calls[5].headers.get('x-takosumi-capabilities'),
      'git.pr.merge',
    );
  } finally {
    restore();
  }
});

test('Git pull request discussion read paths derive from takos-git detail', async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restore = stubGitFetch(
    calls,
    JSON.stringify({
      pullRequest: {
        id: 'pr_1',
        comments: [{ id: 'comment_1', body: 'Looks good' }],
        reviews: [{ id: 'review_1', status: 'approved' }],
      },
    }),
  );
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'viewer',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const comments = await app.request(
      '/api/repositories/repo_1/pull-requests/1/comments?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const reviews = await app.request(
      '/api/repositories/repo_1/pull-requests/1/reviews?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );

    deepStrictEqual(comments.status, 200);
    deepStrictEqual(reviews.status, 200);
    deepStrictEqual(await comments.json(), {
      comments: [{ id: 'comment_1', body: 'Looks good' }],
    });
    deepStrictEqual(await reviews.json(), {
      reviews: [{ id: 'review_1', status: 'approved' }],
    });
    deepStrictEqual(
      calls.map((call) => [new URL(call.url).pathname, call.method]),
      [
        ['/internal/repositories/repo_1/pull-requests/1', 'GET'],
        ['/internal/repositories/repo_1/pull-requests/1', 'GET'],
      ],
    );
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.pr.read',
    );
    deepStrictEqual(
      calls[1].headers.get('x-takosumi-capabilities'),
      'git.pr.read',
    );
  } finally {
    restore();
  }
});

test('Git pull request diff public path signs and proxies to takos-git', async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restore = stubGitFetch(
    calls,
    JSON.stringify({
      repositoryId: 'repo_1',
      files: [],
    }),
  );
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'viewer',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const diff = await app.request(
      '/api/repositories/repo_1/pull-requests/1/diff?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );

    deepStrictEqual(diff.status, 200);
    deepStrictEqual(
      calls.map((call) => [new URL(call.url).pathname, call.method]),
      [['/internal/repositories/repo_1/pull-requests/1/diff', 'GET']],
    );
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.pr.read',
    );
  } finally {
    restore();
  }
});

test('Git pull request AI review forwards through signed git internal RPC with prWrite', async () => {
  // The AI review route used to flow through the unscoped API-side HTTP proxy. F14 promotes it to the capability-gated takos-git RPC so the
  // caller must be a space member and the request signs `git.pr.write`.
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restore = stubGitFetch(
    calls,
    JSON.stringify({ review: { id: 'review_ai' }, comments: [] }),
    201,
  );
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'editor',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const response = await app.request(
      '/api/repositories/repo_1/pull-requests/1/ai-review',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: JSON.stringify({ space_id: 'space_1' }),
      },
      { DB: db },
    );
    const missingSpace = await app.request(
      '/api/repositories/repo_1/pull-requests/1/ai-review',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
        body: '{}',
      },
      { DB: db },
    );

    deepStrictEqual(response.status, 201);
    deepStrictEqual(missingSpace.status, 400);
    deepStrictEqual(
      calls.map((call) => [new URL(call.url).pathname, call.method]),
      [['/internal/repositories/repo_1/pull-requests/1/reviews', 'POST']],
    );
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.pr.write',
    );
  } finally {
    restore();
  }
});

test('Git repository browsing public paths sign and proxy to takos-git', async () => {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const restore = stubGitFetch(calls, JSON.stringify({ entries: [] }));
  const db = fakeApiDb({
    actorAccountId: 'acct_1',
    membershipRole: 'viewer',
    runId: 'run_1',
    threadId: 'thread_1',
    spaceId: 'space_1',
  });
  try {
    const refs = await app.request(
      '/api/repositories/repo_1/refs?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const tree = await app.request(
      '/api/repositories/repo_1/tree?spaceId=space_1&ref=main&path=.',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const branches = await app.request(
      '/api/repositories/repo_1/branches?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const tags = await app.request(
      '/api/repositories/repo_1/tags?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const commit = await app.request(
      '/api/repositories/repo_1/commits/abc123?spaceId=space_1',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );
    const compare = await app.request(
      '/api/repositories/repo_1/compare?spaceId=space_1&base=main&head=feature/docs',
      {
        headers: {
          'x-takos-internal-secret': 'trusted-proxy-secret',
          'x-takos-account-id': 'acct_1',
        },
      },
      { DB: db },
    );

    deepStrictEqual(refs.status, 200);
    deepStrictEqual(tree.status, 200);
    deepStrictEqual(branches.status, 200);
    deepStrictEqual(tags.status, 200);
    deepStrictEqual(commit.status, 200);
    deepStrictEqual(compare.status, 200);
    const refsUrl = new URL(calls[0].url);
    const treeUrl = new URL(calls[1].url);
    const branchesUrl = new URL(calls[2].url);
    const tagsUrl = new URL(calls[3].url);
    const commitUrl = new URL(calls[4].url);
    const compareUrl = new URL(calls[5].url);
    deepStrictEqual(refsUrl.pathname, '/internal/repositories/repo_1/refs');
    deepStrictEqual(treeUrl.pathname, '/internal/repositories/repo_1/tree');
    deepStrictEqual(
      branchesUrl.pathname,
      '/internal/repositories/repo_1/branches',
    );
    deepStrictEqual(tagsUrl.pathname, '/internal/repositories/repo_1/tags');
    deepStrictEqual(
      commitUrl.pathname,
      '/internal/repositories/repo_1/commits/abc123',
    );
    deepStrictEqual(compareUrl.pathname, '/internal/repositories/repo_1/compare');
    deepStrictEqual(treeUrl.searchParams.get('ref'), 'main');
    deepStrictEqual(treeUrl.searchParams.get('path'), '.');
    deepStrictEqual(compareUrl.searchParams.get('base'), 'main');
    deepStrictEqual(compareUrl.searchParams.get('head'), 'feature/docs');
    deepStrictEqual(calls[0].headers.get('x-takosumi-caller'), 'takos-worker');
    deepStrictEqual(calls[0].headers.get('x-takosumi-audience'), 'takos-git');
    deepStrictEqual(
      calls[0].headers.get('x-takosumi-capabilities'),
      'git.repo.read',
    );
    deepStrictEqual(
      calls[1].headers.get('x-takosumi-capabilities'),
      'git.repo.read',
    );
    deepStrictEqual(
      calls[5].headers.get('x-takosumi-capabilities'),
      'git.repo.read',
    );
  } finally {
    restore();
  }
});

test('internal client configuration errors use common error envelope', async () => {
  const originalSecret = getEnv('TAKOS_INTERNAL_SERVICE_SECRET');
  const originalUrl = getEnv('TAKOSUMI_INTERNAL_URL');
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');

  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  deleteEnv('TAKOS_INTERNAL_SERVICE_SECRET');
  deleteEnv('TAKOSUMI_INTERNAL_URL');
  try {
    const response = await app.request('/api/spaces', {
      headers: {
        'x-takos-internal-secret': 'trusted-proxy-secret',
        'x-takos-account-id': 'acct_1',
      },
    });
    const body = await response.json() as {
      error: { code: string; message: string };
    };

    deepStrictEqual(response.status, 500);
    deepStrictEqual(body, {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'internal Takosumi client is not configured',
      },
    });
  } finally {
    restoreEnv('TAKOS_INTERNAL_SERVICE_SECRET', originalSecret);
    restoreEnv('TAKOSUMI_INTERNAL_URL', originalUrl);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  }
});

type AuthValidationCall = {
  token: string;
  issuerUrl?: string;
  discoveryUrl?: string;
  clientId?: string;
  clientSecret?: string;
};

type SignedCall = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
};

type ExternalFetchCall = {
  url: string;
  method: string;
  headers: Headers;
  bodyText: string;
};

type OpaqueLaunchEnv = {
  installationId: string;
  redirectUri: string;
  accountsBaseUrl?: string;
  issuerUrl?: string;
  consumePath?: string;
};

function trustedGetInit() {
  return {
    headers: {
      'x-takos-internal-secret': 'trusted-proxy-secret',
      'x-takos-account-id': 'acct_1',
    },
  };
}

function trustedJsonInit(method: string, body: unknown) {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      'x-takos-internal-secret': 'trusted-proxy-secret',
      'x-takos-account-id': 'acct_1',
    },
    body: JSON.stringify(body),
  };
}

function directAuthEnv(): { DB: SqlDatabaseBinding } {
  return {
    DB: fakeApiDb({
      actorAccountId: 'acct_verified',
      membershipRole: 'owner',
      runId: 'run_1',
      spaceId: 'space_1',
    }),
  };
}

async function assertControlBindingRequired(response: Response): Promise<void> {
  const body = await response.json() as {
    error: { code: string; message: string };
  };
  deepStrictEqual(response.status, 500);
  deepStrictEqual(body.error.code, 'INTERNAL_ERROR');
  ok(
    body.error.message,
    'in-process control routes require the takos-worker DB binding',
  );
}

function stubTakosumiAccountsFetch(
  calls: Array<{ url: string; method: string; body: unknown }>,
  responseBody: unknown,
  status = 200,
  options: {
    opaqueLaunch?: OpaqueLaunchEnv;
  } = {},
) {
  const originalFetch = globalThis.fetch;
  const originalAccountsUrl = getEnv('TAKOSUMI_ACCOUNTS_URL');
  const originalAccountsInternalUrl = getEnv(
    'TAKOSUMI_ACCOUNTS_INTERNAL_URL',
  );
  const originalOidcIssuerUrl = getEnv('OIDC_ISSUER_URL');
  const originalLaunchInstallationId = getEnv(
    'INSTALL_LAUNCH_INSTALLATION_ID',
  );
  const originalLaunchRedirectUri = getEnv(
    'INSTALL_LAUNCH_REDIRECT_URI',
  );
  const originalLaunchConsumePath = getEnv('INSTALL_LAUNCH_CONSUME_PATH');
  const originalInternalSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  const accountsBaseUrl = options.opaqueLaunch?.accountsBaseUrl ??
    'https://accounts.internal';
  setEnv('TAKOSUMI_ACCOUNTS_URL', 'https://accounts.internal');
  deleteEnv('TAKOSUMI_ACCOUNTS_INTERNAL_URL');
  deleteEnv('OIDC_ISSUER_URL');
  deleteEnv('INSTALL_LAUNCH_INSTALLATION_ID');
  deleteEnv('INSTALL_LAUNCH_REDIRECT_URI');
  deleteEnv('INSTALL_LAUNCH_CONSUME_PATH');
  if (options.opaqueLaunch) {
    setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
    setEnv('TAKOSUMI_ACCOUNTS_INTERNAL_URL', accountsBaseUrl);
    setEnv(
      'INSTALL_LAUNCH_INSTALLATION_ID',
      options.opaqueLaunch.installationId,
    );
    setEnv(
      'INSTALL_LAUNCH_REDIRECT_URI',
      options.opaqueLaunch.redirectUri,
    );
    if (options.opaqueLaunch.consumePath) {
      setEnv(
        'INSTALL_LAUNCH_CONSUME_PATH',
        options.opaqueLaunch.consumePath,
      );
    }
    if (options.opaqueLaunch.issuerUrl) {
      setEnv('OIDC_ISSUER_URL', options.opaqueLaunch.issuerUrl);
    }
  }
  const accountsOrigin = new URL(accountsBaseUrl).origin;

  const fetchStub: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const parsedUrl = new URL(url);
    const method = input instanceof Request ? input.method : requestInitMethod(init);
    const bodyText = await requestBody(input, init);
    if (parsedUrl.origin === accountsOrigin) {
      calls.push({
        url,
        method,
        body: parseJsonRecord(bodyText),
      });
      return Response.json(responseBody, { status });
    }
    return Response.json({ error: 'unexpected fetch' }, { status: 500 });
  };
  globalThis.fetch = fetchStub;

  return () => {
    globalThis.fetch = originalFetch;
    restoreEnv('TAKOSUMI_ACCOUNTS_URL', originalAccountsUrl);
    restoreEnv('TAKOSUMI_ACCOUNTS_INTERNAL_URL', originalAccountsInternalUrl);
    restoreEnv('OIDC_ISSUER_URL', originalOidcIssuerUrl);
    restoreEnv(
      'INSTALL_LAUNCH_INSTALLATION_ID',
      originalLaunchInstallationId,
    );
    restoreEnv('INSTALL_LAUNCH_REDIRECT_URI', originalLaunchRedirectUri);
    restoreEnv('INSTALL_LAUNCH_CONSUME_PATH', originalLaunchConsumePath);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalInternalSecret);
  };
}

function stubExternalFetch(
  calls: ExternalFetchCall[],
  response: unknown | Response | Response[],
) {
  const originalFetch = globalThis.fetch;
  let index = 0;

  const fetchStub: typeof fetch = async (fetchInput, init) => {
    const url = fetchInput instanceof Request ? fetchInput.url : String(fetchInput);
    const method = fetchInput instanceof Request ? fetchInput.method : requestInitMethod(init);
    const headers = fetchInput instanceof Request ? new Headers(fetchInput.headers) : requestInitHeaders(init);
    calls.push({
      url,
      method,
      headers,
      bodyText: await requestBody(fetchInput, init),
    });

    if (Array.isArray(response)) {
      return response[Math.min(index++, response.length - 1)].clone();
    }
    if (response instanceof Response) return response.clone();
    return Response.json(response);
  };
  globalThis.fetch = fetchStub;

  return () => {
    globalThis.fetch = originalFetch;
  };
}

function stubAuthVerifiedTakosumiFetch(
  authCalls: AuthValidationCall[],
  calls: SignedCall[],
  responseBody: unknown,
  status = 200,
  authStatus = 200,
) {
  return stubAuthVerifiedFetch({
    authCalls,
    calls,
    internalUrlEnv: 'TAKOSUMI_INTERNAL_URL',
    internalUrl: 'https://takosumi.internal',
    authStatus,
    responseBody,
    status,
  });
}

function stubAuthVerifiedGitFetch(
  authCalls: AuthValidationCall[],
  calls: SignedCall[],
  responseBody: string,
  status = 200,
  authStatus = 200,
) {
  return stubAuthVerifiedFetch({
    authCalls,
    calls,
    internalUrlEnv: 'TAKOS_GIT_INTERNAL_URL',
    internalUrl: 'https://git.internal',
    authStatus,
    responseBody,
    status,
  });
}

function stubAuthVerifiedFetch(input: {
  authCalls: AuthValidationCall[];
  calls: SignedCall[];
  internalUrlEnv: string;
  internalUrl: string;
  authStatus: number;
  responseBody: unknown;
  status: number;
}) {
  const originalFetch = globalThis.fetch;
  const originalValidateTakosumiAccountsBearer = authDeps.validateTakosumiAccountsBearer;
  const originalGetCachedUser = authDeps.getCachedUser;
  const originalSecret = getEnv('TAKOS_INTERNAL_SERVICE_SECRET');
  const originalInternalUrl = getEnv(input.internalUrlEnv);
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');

  setEnv('TAKOS_INTERNAL_SERVICE_SECRET', 'test-secret');
  setEnv(input.internalUrlEnv, input.internalUrl);
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');

  authDeps.validateTakosumiAccountsBearer = (validation) => {
    input.authCalls.push({
      token: validation.token,
      issuerUrl: validation.issuerUrl,
      discoveryUrl: validation.discoveryUrl,
      clientId: validation.clientId,
      clientSecret: validation.clientSecret,
    });
    if (input.authStatus !== 200) return Promise.resolve(null);
    return Promise.resolve({
      userId: 'acct_verified',
      scopes: ['openid', 'profile'],
      tokenKind: 'takosumi_accounts',
      issuer: 'https://accounts.example.test',
      subject: 'sub_verified',
    });
  };
  authDeps.getCachedUser = (_c, userId) => Promise.resolve(userId === 'acct_verified' ? verifiedAuthUser() : null);

  const fetchStub: typeof fetch = async (fetchInput, init) => {
    const url = fetchInput instanceof Request ? fetchInput.url : String(fetchInput);
    const method = fetchInput instanceof Request ? fetchInput.method : requestInitMethod(init);
    const headers = fetchInput instanceof Request ? new Headers(fetchInput.headers) : requestInitHeaders(init);
    const body = await requestBody(fetchInput, init);
    input.calls.push({
      url,
      method,
      headers,
      body: parseJsonRecord(body),
    });
    if (typeof input.responseBody === 'string') {
      return new Response(input.responseBody, { status: input.status });
    }
    return Response.json(input.responseBody, { status: input.status });
  };
  globalThis.fetch = fetchStub;

  return () => {
    globalThis.fetch = originalFetch;
    authDeps.validateTakosumiAccountsBearer = originalValidateTakosumiAccountsBearer;
    authDeps.getCachedUser = originalGetCachedUser;
    restoreEnv('TAKOS_INTERNAL_SERVICE_SECRET', originalSecret);
    restoreEnv(input.internalUrlEnv, originalInternalUrl);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  };
}

function verifiedAuthUser(): User {
  const now = '2026-05-31T00:00:00.000Z';
  return {
    id: 'acct_verified',
    email: 'verified@example.test',
    name: 'Verified User',
    username: 'verified',
    bio: null,
    picture: null,
    trust_tier: 'verified',
    setup_completed: true,
    created_at: now,
    updated_at: now,
  };
}

function stubTakosumiFetch(
  calls: Array<{ url: string; method: string; body: unknown }>,
  responseBody: unknown | unknown[],
  status = 200,
) {
  const originalFetch = globalThis.fetch;
  const originalSecret = getEnv('TAKOS_INTERNAL_SERVICE_SECRET');
  const originalUrl = getEnv('TAKOSUMI_INTERNAL_URL');
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');
  let index = 0;

  setEnv('TAKOS_INTERNAL_SERVICE_SECRET', 'test-secret');
  setEnv('TAKOSUMI_INTERNAL_URL', 'https://takosumi.internal');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  const fetchStub: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const bodyText = await requestBody(input, init);
    calls.push({
      url,
      method: input instanceof Request ? input.method : requestInitMethod(init),
      body: bodyText ? JSON.parse(bodyText) : {},
    });
    const body = Array.isArray(responseBody) ? responseBody[Math.min(index++, responseBody.length - 1)] : responseBody;
    return await Promise.resolve(Response.json(body, { status }));
  };
  globalThis.fetch = fetchStub;

  return () => {
    globalThis.fetch = originalFetch;
    restoreEnv('TAKOS_INTERNAL_SERVICE_SECRET', originalSecret);
    restoreEnv('TAKOSUMI_INTERNAL_URL', originalUrl);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  };
}

function stubRuntimeFetch(
  calls: Array<{ url: string; method: string; body: unknown }>,
  responseBody: unknown,
  status = 200,
) {
  const originalFetch = globalThis.fetch;
  const originalSecret = getEnv('TAKOS_INTERNAL_SERVICE_SECRET');
  const originalUrl = getEnv('TAKOSUMI_INTERNAL_URL');
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');

  setEnv('TAKOS_INTERNAL_SERVICE_SECRET', 'test-secret');
  setEnv('TAKOSUMI_INTERNAL_URL', 'https://takosumi.internal');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  const fetchStub: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const bodyText = await requestBody(input, init);
    calls.push({
      url,
      method: input instanceof Request ? input.method : requestInitMethod(init),
      body: bodyText ? JSON.parse(bodyText) : {},
    });
    return await Promise.resolve(Response.json(responseBody, { status }));
  };
  globalThis.fetch = fetchStub;

  return () => {
    globalThis.fetch = originalFetch;
    restoreEnv('TAKOS_INTERNAL_SERVICE_SECRET', originalSecret);
    restoreEnv('TAKOSUMI_INTERNAL_URL', originalUrl);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  };
}

function stubGitFetch(
  calls: Array<{ url: string; method: string; headers: Headers }>,
  responseBody: string,
  status = 200,
) {
  const originalFetch = globalThis.fetch;
  const originalSecret = getEnv('TAKOS_INTERNAL_SERVICE_SECRET');
  const originalUrl = getEnv('TAKOS_GIT_INTERNAL_URL');
  const originalTrustedSecret = getEnv('TAKOS_INTERNAL_API_SECRET');

  setEnv('TAKOS_INTERNAL_SERVICE_SECRET', 'test-secret');
  setEnv('TAKOS_GIT_INTERNAL_URL', 'https://git.internal');
  setEnv('TAKOS_INTERNAL_API_SECRET', 'trusted-proxy-secret');
  const fetchStub: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({
      url,
      method: input instanceof Request ? input.method : requestInitMethod(init),
      headers: input instanceof Request ? new Headers(input.headers) : requestInitHeaders(init),
    });
    return await Promise.resolve(new Response(responseBody, { status }));
  };
  globalThis.fetch = fetchStub;

  return () => {
    globalThis.fetch = originalFetch;
    restoreEnv('TAKOS_INTERNAL_SERVICE_SECRET', originalSecret);
    restoreEnv('TAKOS_GIT_INTERNAL_URL', originalUrl);
    restoreEnv('TAKOS_INTERNAL_API_SECRET', originalTrustedSecret);
  };
}

function fakeApiDb(config: {
  actorAccountId: string;
  membershipRole: string | null;
  runId: string;
  threadId?: string;
  spaceId: string;
  threads?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  threadShares?: Array<Record<string, unknown>>;
  runs?: Array<Record<string, unknown>>;
  runEvents?: Array<Record<string, unknown>>;
  artifacts?: Array<Record<string, unknown>>;
  agentTasks?: Array<Record<string, unknown>>;
  sessions?: Array<Record<string, unknown>>;
}): SqlDatabaseBinding {
  const artifactRows = [...(config.artifacts ?? [])];
  const messageRows = [...(config.messages ?? [])];
  const threadShareRows = [...(config.threadShares ?? [])];
  const runEventRows = [...(config.runEvents ?? [])];
  const runRows = [...(config.runs ?? [fakeRunDetailRow(config)])];
  const agentTaskRows = [...(config.agentTasks ?? [])];
  const sessionRows = [...(config.sessions ?? [])];
  const threadId = config.threadId ?? 'thread_1';
  const threadRows = [
    ...(config.threads ??
      [fakeThreadRow({ threadId, spaceId: config.spaceId })]),
  ];
  return {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            first<T>() {
              if (query.includes('INSERT INTO artifacts')) {
                const [
                  id,
                  runId,
                  accountId,
                  type,
                  title,
                  content,
                  fileId,
                  metadata,
                  createdAt,
                ] = values;
                const row = {
                  id,
                  runId,
                  accountId,
                  type,
                  title,
                  content,
                  fileId,
                  metadata,
                  createdAt,
                };
                artifactRows.push(row);
                return Promise.resolve(row as T);
              }
              if (query.includes('INSERT INTO thread_shares')) {
                const [
                  id,
                  threadId,
                  spaceId,
                  createdBy,
                  token,
                  mode,
                  passwordHash,
                  expiresAt,
                  createdAt,
                ] = values;
                const row = {
                  id,
                  threadId,
                  spaceId,
                  createdBy,
                  token,
                  mode,
                  passwordHash,
                  expiresAt,
                  revokedAt: null,
                  lastAccessedAt: null,
                  createdAt,
                };
                threadShareRows.push(row);
                return Promise.resolve(row as T);
              }
              if (query.includes('INSERT INTO run_events')) {
                const [runId, type, data, createdAt] = values;
                const id = runEventRows.reduce(
                  (max, row) => Math.max(max, Number(row.id)),
                  0,
                ) + 1;
                const row = { id, runId, type, data, createdAt };
                runEventRows.push(row);
                return Promise.resolve({ id } as T);
              }
              if (query.includes('FROM runs')) {
                const run = runRows.find((row) => row.id === values[0]) ??
                  null;
                return Promise.resolve(
                  run as T,
                );
              }
              if (query.includes('FROM threads')) {
                const thread = threadRows.find((row) => row.id === values[0]) ??
                  null;
                return Promise.resolve(thread as T);
              }
              if (query.includes('FROM accounts')) {
                if (query.includes('ai_model')) {
                  return Promise.resolve(
                    (values[0] === config.spaceId ? { aiModel: null } : null) as T,
                  );
                }
                return Promise.resolve(
                  (values[0] === config.actorAccountId ? { id: config.actorAccountId } : null) as T,
                );
              }
              if (query.includes('FROM account_memberships')) {
                return Promise.resolve(
                  (
                    values[0] === config.spaceId &&
                      values[1] === config.actorAccountId &&
                      config.membershipRole
                      ? { role: config.membershipRole }
                      : null
                  ) as T,
                );
              }
              if (query.includes('FROM messages')) {
                const rows = messageRows.filter((row) => row.threadId === values[0]);
                if (query.includes('MAX(sequence)')) {
                  const maxSeq = rows.reduce(
                    (max, row) => Math.max(max, Number(row.sequence)),
                    -1,
                  );
                  return Promise.resolve({ maxSeq } as T);
                }
                return Promise.resolve({ count: rows.length } as T);
              }
              if (query.includes('FROM artifacts')) {
                const artifact = artifactRows.find((row) => row.id === values[0]) ?? null;
                return Promise.resolve(artifact as T);
              }
              if (query.includes('FROM sessions')) {
                const session = sessionRows.find((row) => row.id === values[0]) ?? null;
                return Promise.resolve(session as T);
              }
              return Promise.resolve(null as T);
            },
            run<T>() {
              if (query.includes('INSERT INTO threads')) {
                const [
                  id,
                  spaceId,
                  title,
                  locale,
                  status,
                  createdAt,
                  updatedAt,
                ] = values;
                threadRows.push({
                  id,
                  spaceId,
                  title,
                  locale,
                  status,
                  summary: null,
                  keyPoints: '[]',
                  retrievalIndex: -1,
                  contextWindow: 50,
                  createdAt,
                  updatedAt,
                });
              }
              if (query.includes('INSERT INTO messages')) {
                const [
                  id,
                  threadId,
                  role,
                  content,
                  r2Key,
                  toolCalls,
                  toolCallId,
                  metadata,
                  sequence,
                  createdAt,
                ] = values;
                messageRows.push({
                  id,
                  threadId,
                  role,
                  content,
                  r2Key,
                  toolCalls,
                  toolCallId,
                  metadata,
                  sequence,
                  createdAt,
                });
              }
              if (query.includes('INSERT INTO runs')) {
                const [
                  id,
                  threadId,
                  spaceId,
                  requesterAccountId,
                  parentRunId,
                  childThreadId,
                  rootThreadId,
                  rootRunId,
                  agentType,
                  input,
                  createdAt,
                ] = values;
                runRows.push({
                  id,
                  threadId,
                  spaceId,
                  accountId: spaceId,
                  requesterAccountId,
                  sessionId: null,
                  parentRunId,
                  childThreadId,
                  rootThreadId,
                  rootRunId,
                  agentType,
                  status: 'pending',
                  input,
                  output: null,
                  error: null,
                  usage: '{}',
                  serviceId: null,
                  serviceHeartbeat: null,
                  startedAt: null,
                  completedAt: null,
                  createdAt,
                });
              }
              if (query.includes('UPDATE thread_shares')) {
                const revokedAt = values[0];
                const shareId = values[1];
                const threadId = values[2];
                const row = threadShareRows.find((row) =>
                  row.id === shareId &&
                  row.threadId === threadId &&
                  row.revokedAt == null
                );
                if (row) {
                  row.revokedAt = revokedAt;
                }
                return Promise.resolve({
                  results: [],
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: 0,
                    rows_written: row ? 1 : 0,
                    last_row_id: 0,
                    changed_db: Boolean(row),
                    changes: row ? 1 : 0,
                  },
                } as T);
              }
              if (query.includes('UPDATE runs')) {
                const runId = values[values.length - 1];
                const row = runRows.find((row) => row.id === runId);
                if (row) {
                  const setSql = query.slice(
                    query.indexOf('SET') + 3,
                    query.indexOf('WHERE'),
                  );
                  let valueIndex = 0;
                  for (const assignment of setSql.split(',')) {
                    const column = assignment.trim().split(/\s+/)[0];
                    const value = values[valueIndex++];
                    if (column === 'status') row.status = value;
                    if (column === 'error') row.error = value;
                    if (column === 'completed_at') row.completedAt = value;
                  }
                }
                return Promise.resolve({
                  results: [],
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: 0,
                    rows_written: row ? 1 : 0,
                    last_row_id: 0,
                    changed_db: Boolean(row),
                    changes: row ? 1 : 0,
                  },
                } as T);
              }
              if (query.includes('UPDATE threads')) {
                const threadId = values[values.length - 1];
                const row = threadRows.find((row) => row.id === threadId);
                if (row) {
                  const setSql = query.slice(
                    query.indexOf('SET') + 3,
                    query.indexOf('WHERE'),
                  );
                  let valueIndex = 0;
                  for (const assignment of setSql.split(',')) {
                    const column = assignment.trim().split(/\s+/)[0];
                    const value = values[valueIndex++];
                    if (column === 'updated_at') row.updatedAt = value;
                    if (column === 'title') row.title = value;
                    if (column === 'locale') row.locale = value;
                    if (column === 'status') row.status = value;
                    if (column === 'context_window') {
                      row.contextWindow = value;
                    }
                  }
                }
                return Promise.resolve({
                  results: [],
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: 0,
                    rows_written: row ? 1 : 0,
                    last_row_id: 0,
                    changed_db: Boolean(row),
                    changes: row ? 1 : 0,
                  },
                } as T);
              }
              return Promise.resolve({
                results: [],
                success: true,
                meta: {
                  duration: 0,
                  size_after: 0,
                  rows_read: 0,
                  rows_written: 1,
                  last_row_id: 0,
                  changed_db: true,
                  changes: 1,
                },
              } as T);
            },
            all<T>() {
              if (query.includes('JOIN threads')) {
                const spaceId = values[0];
                const needle = likeNeedle(values[1]);
                const limit = Number(values[2] ?? 20);
                const offset = Number(values[3] ?? 0);
                const results = messageRows
                  .flatMap((message) => {
                    const thread = threadRows.find((row) => row.id === message.threadId);
                    if (!thread) return [];
                    if (thread.spaceId !== spaceId) return [];
                    if (thread.status === 'deleted') return [];
                    if (
                      !String(message.content).toLowerCase().includes(needle)
                    ) {
                      return [];
                    }
                    return [{
                      threadId: thread.id,
                      threadTitle: thread.title,
                      threadStatus: thread.status,
                      threadCreatedAt: thread.createdAt,
                      threadUpdatedAt: thread.updatedAt,
                      messageId: message.id,
                      messageRole: message.role,
                      messageContent: message.content,
                      messageSequence: message.sequence,
                      messageCreatedAt: message.createdAt,
                    }];
                  })
                  .sort((a, b) =>
                    String(b.messageCreatedAt).localeCompare(
                      String(a.messageCreatedAt),
                    )
                  )
                  .slice(offset, offset + limit);
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              if (query.includes('FROM thread_shares')) {
                const results = threadShareRows
                  .filter((row) => row.threadId === values[0])
                  .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              if (query.includes('FROM messages')) {
                if (query.includes('content LIKE')) {
                  const needle = likeNeedle(values[1]);
                  const limit = Number(values[2] ?? 20);
                  const offset = Number(values[3] ?? 0);
                  const results = messageRows
                    .filter((row) => row.threadId === values[0])
                    .filter((row) => String(row.content).toLowerCase().includes(needle))
                    .sort((a, b) => Number(a.sequence) - Number(b.sequence))
                    .slice(offset, offset + limit);
                  return Promise.resolve({
                    results,
                    success: true,
                    meta: {
                      duration: 0,
                      size_after: 0,
                      rows_read: results.length,
                      rows_written: 0,
                      last_row_id: 0,
                      changed_db: false,
                      changes: 0,
                    },
                  } as T);
                }
                const limit = Number(values[1] ?? 100);
                const offset = Number(values[2] ?? 0);
                const results = messageRows
                  .filter((row) => row.threadId === values[0])
                  .sort((a, b) => Number(a.sequence) - Number(b.sequence))
                  .slice(offset, offset + limit);
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              if (query.includes('FROM threads')) {
                const status = query.includes('status = ?') ? String(values[1]) : null;
                const results = threadRows
                  .filter((row) => row.spaceId === values[0])
                  .filter((row) => status ? row.status === status : row.status !== 'deleted')
                  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              if (query.includes('FROM run_events')) {
                if (query.includes(' IN ')) {
                  const runIds = new Set(values.map(String));
                  const results = runEventRows
                    .filter((row) => runIds.has(String(row.runId)))
                    .sort((a, b) =>
                      String(a.createdAt).localeCompare(
                        String(b.createdAt),
                      ) ||
                      Number(a.id) - Number(b.id)
                    );
                  return Promise.resolve({
                    results,
                    success: true,
                    meta: {
                      duration: 0,
                      size_after: 0,
                      rows_read: results.length,
                      rows_written: 0,
                      last_row_id: 0,
                      changed_db: false,
                      changes: 0,
                    },
                  } as T);
                }
                const afterEventId = Number(values[1] ?? 0);
                const results = runEventRows
                  .filter((row) => row.runId === values[0])
                  .filter((row) => Number(row.id) > afterEventId)
                  .sort((a, b) => Number(a.id) - Number(b.id));
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              if (query.includes('FROM runs')) {
                const limit = query.includes('LIMIT 10')
                  ? 10
                  : query.includes('LIMIT')
                  ? Number(values[values.length - 1] ?? 50)
                  : Number.POSITIVE_INFINITY;
                const activeOnly = query.includes('status IN');
                const useRootThread = query.includes('root_thread_id = ?');
                const results = runRows
                  .filter((row) => useRootThread ? row.rootThreadId === values[0] : row.threadId === values[0])
                  .filter((row) =>
                    !activeOnly ||
                    ['pending', 'queued', 'running'].includes(
                      String(row.status),
                    )
                  )
                  .sort((a, b) =>
                    String(b.createdAt).localeCompare(String(a.createdAt)) ||
                    String(b.id).localeCompare(String(a.id))
                  )
                  .slice(0, limit);
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              if (query.includes('FROM artifacts')) {
                const runIds = query.includes(' IN ') ? new Set(values.map(String)) : new Set([String(values[0])]);
                const results = artifactRows
                  .filter((row) => runIds.has(String(row.runId)))
                  .sort((a, b) =>
                    String(a.createdAt).localeCompare(String(b.createdAt)) ||
                    String(a.id).localeCompare(String(b.id))
                  );
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              if (query.includes('FROM agent_tasks')) {
                const results = agentTaskRows
                  .filter((row) => row.threadId === values[0])
                  .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
                  .slice(0, 5);
                return Promise.resolve({
                  results,
                  success: true,
                  meta: {
                    duration: 0,
                    size_after: 0,
                    rows_read: results.length,
                    rows_written: 0,
                    last_row_id: 0,
                    changed_db: false,
                    changes: 0,
                  },
                } as T);
              }
              return unsupportedDbOperation();
            },
            raw: unsupportedDbOperation,
          };
        },
        first: unsupportedDbOperation,
        run: unsupportedDbOperation,
        all: unsupportedDbOperation,
        raw: unsupportedDbOperation,
      };
    },
    batch: unsupportedDbOperation,
    exec: unsupportedDbOperation,
    withSession() {
      throw new Error('unsupported');
    },
    dump: unsupportedDbOperation,
  } as unknown as SqlDatabaseBinding;
}

function fakeExploreSuggestDb(): SqlDatabaseBinding {
  const users = [{
    slug: 'docs',
    name: 'Docs User',
    picture: 'https://example.test/avatar.png',
  }];
  const repos = [{
    id: 'repo_1',
    name: 'docs-app',
    description: 'Docs app',
    stars: 42,
    updatedAt: '2026-05-13T00:00:00.000Z',
    accountId: 'acct_1',
    accountSlug: 'docs',
    accountName: 'Docs User',
    accountPicture: 'https://example.test/avatar.png',
  }];
  return {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            first: unsupportedDbOperation,
            run: unsupportedDbOperation,
            all<T>() {
              const limit = Number(values[values.length - 1] ?? 20);
              const results = query.includes('FROM repositories') ? repos.slice(0, limit) : users.slice(0, limit);
              return Promise.resolve({
                results,
                success: true,
                meta: {
                  duration: 0,
                  size_after: 0,
                  rows_read: results.length,
                  rows_written: 0,
                  last_row_id: 0,
                  changed_db: false,
                  changes: 0,
                },
              } as T);
            },
            raw: unsupportedDbOperation,
          };
        },
        first: unsupportedDbOperation,
        run: unsupportedDbOperation,
        all: unsupportedDbOperation,
        raw: unsupportedDbOperation,
      };
    },
    batch: unsupportedDbOperation,
    exec: unsupportedDbOperation,
    withSession() {
      throw new Error('unsupported');
    },
    dump: unsupportedDbOperation,
  } as unknown as SqlDatabaseBinding;
}

function fakeArtifactRow(
  id: string,
  runId: string,
  spaceId: string,
): Record<string, unknown> {
  return {
    id,
    runId,
    accountId: spaceId,
    type: 'doc',
    title: 'Result',
    content: 'done',
    fileId: null,
    metadata: '{}',
    createdAt: '2026-05-13T00:01:00.000Z',
  };
}

function fakeMessageRow(config: {
  messageId: string;
  threadId: string;
  role?: string;
  sequence: number;
  content?: string;
}): Record<string, unknown> {
  return {
    id: config.messageId,
    threadId: config.threadId,
    role: config.role ?? 'user',
    content: config.content ?? 'hello',
    r2Key: null,
    toolCalls: null,
    toolCallId: null,
    metadata: '{}',
    sequence: config.sequence,
    createdAt: '2026-05-13T00:00:00.000Z',
  };
}

function fakeThreadShareRow(config: {
  shareId: string;
  threadId: string;
  spaceId: string;
  token: string;
}): Record<string, unknown> {
  return {
    id: config.shareId,
    threadId: config.threadId,
    spaceId: config.spaceId,
    createdBy: 'acct_1',
    token: config.token,
    mode: 'public',
    expiresAt: null,
    revokedAt: null,
    lastAccessedAt: null,
    createdAt: '2026-05-13T00:00:00.000Z',
  };
}

function fakeRunDetailRow(config: {
  runId: string;
  threadId?: string;
  spaceId: string;
  status?: string;
  sessionId?: string | null;
  parentRunId?: string | null;
  childThreadId?: string | null;
  rootThreadId?: string | null;
  rootRunId?: string | null;
  completedAt?: string | null;
  createdAt?: string;
}): Record<string, unknown> {
  return {
    id: config.runId,
    threadId: config.threadId ?? 'thread_1',
    spaceId: config.spaceId,
    accountId: config.spaceId,
    sessionId: config.sessionId ?? null,
    parentRunId: config.parentRunId ?? null,
    childThreadId: config.childThreadId ?? null,
    rootThreadId: config.rootThreadId ?? null,
    rootRunId: config.rootRunId ?? null,
    agentType: 'default',
    status: config.status ?? 'running',
    input: '{}',
    output: null,
    error: null,
    usage: '{}',
    serviceId: null,
    serviceHeartbeat: null,
    startedAt: null,
    completedAt: config.completedAt ?? null,
    createdAt: config.createdAt ?? '2026-05-13T00:00:00.000Z',
  };
}

function fakeRunEventRow(config: {
  id: number;
  runId: string;
  type: string;
  data: string;
  createdAt?: string;
}): Record<string, unknown> {
  return {
    id: config.id,
    runId: config.runId,
    type: config.type,
    data: config.data,
    createdAt: config.createdAt ?? '2026-05-13T00:00:00.000Z',
  };
}

function fakeThreadRow(config: {
  threadId: string;
  spaceId: string;
  status?: string;
  contextWindow?: number;
  updatedAt?: string;
}): Record<string, unknown> {
  return {
    id: config.threadId,
    spaceId: config.spaceId,
    title: 'Thread title',
    locale: 'ja',
    status: config.status ?? 'active',
    summary: null,
    keyPoints: '[]',
    retrievalIndex: -1,
    contextWindow: config.contextWindow ?? 50,
    createdAt: '2026-05-13T00:00:00.000Z',
    updatedAt: config.updatedAt ?? '2026-05-13T00:03:00.000Z',
  };
}

function fakeAgentTaskRow(config: {
  taskId: string;
  threadId: string;
  status: string;
  priority: string;
  updatedAt?: string;
}): Record<string, unknown> {
  return {
    id: config.taskId,
    threadId: config.threadId,
    title: 'Task title',
    status: config.status,
    priority: config.priority,
    updatedAt: config.updatedAt ?? '2026-05-13T00:05:00.000Z',
  };
}

function fakeSessionRow(config: {
  sessionId: string;
  status: string;
  repoId?: string | null;
}): Record<string, unknown> {
  return {
    id: config.sessionId,
    status: config.status,
    repoId: config.repoId ?? null,
  };
}

function unsupportedDbOperation(): never {
  throw new Error('unsupported');
}

function likeNeedle(value: unknown): string {
  return String(value ?? '').replace(/^%|%$/g, '').toLowerCase();
}

function restoreEnv(
  key: string | undefined,
  value?: string | undefined,
): void {
  if (key === undefined) return;
  if (value === undefined) {
    deleteEnv(key);
  } else {
    process.env[key] = value;
  }
}

function deleteEnv(key: string): void {
  delete process.env[key];
}

function getEnv(key: string): string | undefined {
  return process.env[key];
}

function setEnv(
  values: string | Record<string, string>,
  value?: string,
): (() => void) | void {
  if (typeof values === 'string') {
    if (value !== undefined) {
      process.env[values] = value;
    }
    return;
  }
  const previous = new Map(
    Object.keys(values).map((key) => [key, getEnv(key)]),
  );
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) restoreEnv(key, value);
  };
}

function requestInitMethod(init: unknown): string {
  if (typeof init !== 'object' || init === null || !('method' in init)) {
    return 'GET';
  }
  const method = (init as { method?: unknown }).method;
  return typeof method === 'string' && method.length > 0 ? method : 'GET';
}

function requestInitHeaders(init: unknown): Headers {
  if (typeof init !== 'object' || init === null || !('headers' in init)) {
    return new Headers();
  }
  return new Headers((init as { headers?: HeadersInit }).headers);
}

async function requestBody(
  fetchInput: Request | URL | string,
  init?: unknown,
): Promise<string> {
  if (fetchInput instanceof Request) return await fetchInput.clone().text();
  const body = typeof init === 'object' && init !== null && 'body' in init
    ? (init as { body?: unknown }).body
    : undefined;
  if (typeof body === 'string') return body;
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  return '';
}

function parseJsonRecord(body: string): Record<string, unknown> {
  if (!body) return {};
  const value = JSON.parse(body) as unknown;
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function actorFromSignedHeaders(
  headers: Headers,
): Record<string, unknown> {
  const actorHeader = headers.get('x-takos-actor-context') ??
    headers.get('x-takosumi-actor-context');
  if (!actorHeader) return {};
  return JSON.parse(atob(actorHeader)) as Record<string, unknown>;
}
