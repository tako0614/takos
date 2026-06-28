import { test } from "bun:test";
import { assertEquals, assertObjectMatch } from "@takos/test/assert";
import { Hono } from "hono";
import { isAppError } from "@takos/worker-platform-utils/errors";

import appInstallationsRouter, {
  appInstallationsRouteDeps,
} from "./app-installations.ts";
import { routeAuthDeps } from "./route-auth.ts";
import type { Env } from "../../shared/types/index.ts";
import type {
  DefaultAppDistributionEntry,
  DefaultAppInstallConfig,
} from "../../application/services/source/default-app-distribution.ts";
import { installableAppInstallDeps } from "../../application/services/source/installable-app-install.ts";

const originalRouteAuthDeps = { ...routeAuthDeps };
const originalAppInstallationsRouteDeps = { ...appInstallationsRouteDeps };
const originalInstallableAppInstallDeps = { ...installableAppInstallDeps };

function restoreDeps() {
  Object.assign(routeAuthDeps, originalRouteAuthDeps);
  Object.assign(appInstallationsRouteDeps, originalAppInstallationsRouteDeps);
  Object.assign(installableAppInstallDeps, originalInstallableAppInstallDeps);
}

function createApp() {
  const app = new Hono<{
    Bindings: Env;
    Variables: { user: { id: string } };
  }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(
        error.toResponse(),
        error.statusCode as
          | 400
          | 401
          | 403
          | 404
          | 409
          | 410
          | 422
          | 429
          | 500
          | 501
          | 502
          | 503
          | 504,
      );
    }
    throw error;
  });
  app.use("*", async (c, next) => {
    c.set("user", { id: "user-1" });
    await next();
  });
  app.route("/", appInstallationsRouter);
  return app;
}

const defaultAppEntry = {
  name: "takos-docs",
  title: "Takos Docs",
  appId: "jp.takos.docs",
  repositoryUrl: "https://github.com/tako0614/takos-docs",
  ref: "v0.1.2",
  refType: "tag",
  runtimeModes: ["shared-cell", "dedicated", "self-hosted"],
  preinstall: true,
} satisfies DefaultAppDistributionEntry;

const roadToMeCatalogEntry = {
  name: "road-to-me",
  title: "Road to Me",
  appId: "jp.takos.road-to-me",
  repositoryUrl: "https://github.com/tako0614/road-to-me.git",
  ref: "v0.1.0",
  refType: "tag",
  runtimeModes: ["dedicated", "self-hosted"],
  preinstall: false,
} satisfies DefaultAppDistributionEntry;

const installConfig = {
  installUrl: "https://installer.internal/v1/installation-projections",
  token: "install-token",
  subject: "operator-subject",
  mode: "shared-cell",
} satisfies DefaultAppInstallConfig;

test("app-installations route applies a default app through Installation", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  appInstallationsRouteDeps.resolveDefaultAppDistributionForBootstrap =
    async () => [defaultAppEntry];
  appInstallationsRouteDeps.resolveDefaultAppInstallConfig = () =>
    installConfig;
  appInstallationsRouteDeps.applyDefaultAppInstallation = async (
    entry,
    config,
    params,
  ) => {
    calls.push({ kind: "apply", entry, config, params });
    return {
      accounts: {
        installationId: "inst_1",
        status: "ready",
      },
    };
  };

  try {
    const response = await createApp().request(
      "/spaces/space-alias/app-installations/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: "jp.takos.docs",
          mode: "shared-cell",
        }),
      },
      { DB: {} } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 202);
    assertObjectMatch(body, {
      installation: {
        installed: true,
        installation_id: "inst_1",
        app_id: "jp.takos.docs",
        status: "ready",
        runtime_mode: "shared-cell",
        installed_version: "v0.1.2",
      },
      subject_source: "operator_config",
    });
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      {
        kind: "apply",
        entry: defaultAppEntry,
        config: installConfig,
        params: {
          spaceId: "space-1",
          createdByAccountId: "space-1",
          mode: "shared-cell",
        },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route applies catalog-only road-to-me by app_id", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  appInstallationsRouteDeps.resolveDefaultAppDistributionForBootstrap =
    async () => [defaultAppEntry, roadToMeCatalogEntry];
  appInstallationsRouteDeps.resolveDefaultAppInstallConfig = () =>
    installConfig;
  appInstallationsRouteDeps.applyDefaultAppInstallation = async (
    entry,
    config,
    params,
  ) => {
    calls.push({ kind: "apply", entry, config, params });
    return {
      accounts: {
        installationId: "inst_road",
        status: "ready",
      },
    };
  };

  try {
    const response = await createApp().request(
      "/spaces/space-alias/app-installations/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: "jp.takos.road-to-me",
          mode: "dedicated",
        }),
      },
      { DB: {} } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 202);
    assertObjectMatch(body, {
      installation: {
        installed: true,
        installation_id: "inst_road",
        app_id: "jp.takos.road-to-me",
        status: "ready",
        runtime_mode: "dedicated",
        installed_version: "v0.1.0",
      },
      subject_source: "operator_config",
    });
    assertEquals(calls.at(-1), {
      kind: "apply",
      entry: roadToMeCatalogEntry,
      config: installConfig,
      params: {
        spaceId: "space-1",
        createdByAccountId: "space-1",
        mode: "dedicated",
      },
    });
  } finally {
    restoreDeps();
  }
});

test("app-installations route requires Installation install config", async () => {
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: "space-1" }, membership: { role: "editor" } }) as never;
  appInstallationsRouteDeps.resolveDefaultAppDistributionForBootstrap =
    async () => [defaultAppEntry];
  appInstallationsRouteDeps.resolveDefaultAppInstallConfig = () => null;

  try {
    const response = await createApp().request(
      "/spaces/space-1/app-installations/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ app_id: "jp.takos.docs" }),
      },
      { DB: {} } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 503);
    assertObjectMatch(body, {
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Installation install is not configured",
      },
    });
  } finally {
    restoreDeps();
  }
});

test("app-installations route rejects camelCase request aliases", async () => {
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: "space-1" }, membership: { role: "editor" } }) as never;

  try {
    const response = await createApp().request(
      "/spaces/space-1/app-installations/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appId: "jp.takos.docs" }),
      },
      { DB: {} } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 400);
    assertObjectMatch(body, {
      error: {
        code: "BAD_REQUEST",
        message: "app_id is required",
      },
    });
  } finally {
    restoreDeps();
  }
});

test("app-installations route proxies Git URL install plan Run", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  installableAppInstallDeps.fetch = async (input, init) => {
    const inputUrl = String(input);
    calls.push({
      kind: "fetch",
      input: inputUrl,
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({
      source: {
        kind: "git",
        url: "https://github.com/example/app.git",
        ref: "v1.2.3",
        commit: "1111111111111111111111111111111111111111",
      },
      planDigest: "sha256:abc",
      installPlan: {
        repo: { id: "example.app", name: "Example App" },
        changes: [],
      },
      changes: [],
      expected: {
        commit: "1111111111111111111111111111111111111111",
        planDigest: "sha256:abc",
      },
    });
  };

  try {
    const response = await createApp().request(
      "/spaces/space-alias/app-installations/git-url/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.3",
          module_path: ".",
          variables: {
            worker_name: "example-app",
          },
        }),
      },
      {
        DB: {},
        TAKOS_APP_INSTALLATIONS_URL:
          "https://installer.internal/v1/installation-projections",
        TAKOS_APP_INSTALL_TOKEN: "install-token",
      } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 200);
    assertObjectMatch(body, {
      planDigest: "sha256:abc",
    });
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      {
        kind: "fetch",
        input:
          "https://installer.internal/v1/installation-projections/plan-runs",
        method: "POST",
        authorization: "Bearer install-token",
        body: {
          spaceId: "space-1",
          source: {
            kind: "git",
            url: "https://github.com/example/app.git",
            ref: "v1.2.3",
            modulePath: ".",
          },
          variables: {
            worker_name: "example-app",
          },
        },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route proxies Git URL install apply with approval evidence", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  installableAppInstallDeps.fetch = async (input, init) => {
    const inputUrl = String(input);
    calls.push({
      kind: "fetch",
      input: inputUrl,
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json(
      {
        ok: true,
        kind: "takosumi.installation-apply@v1",
        accounts: {
          installationId: "inst_git_1",
          status: "ready",
        },
      },
      { status: 202 },
    );
  };

  try {
    const response = await createApp().request(
      "/spaces/space-alias/app-installations/git-url/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.3",
          mode: "shared-cell",
          expected_commit: "1111111111111111111111111111111111111111",
          expected_plan_digest: "sha256:abc",
          cost_ack: true,
        }),
      },
      {
        DB: {},
        TAKOS_APP_INSTALLATIONS_URL:
          "https://installer.internal/v1/installation-projections",
        TAKOS_APP_INSTALL_TOKEN: "install-token",
        TAKOS_APP_INSTALL_ACCOUNT_ID: "acct_operator",
        TAKOS_APP_INSTALL_SUBJECT: "operator-subject",
      } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 202);
    assertObjectMatch(body, {
      ok: true,
      kind: "takosumi.installation-apply@v1",
      accounts: {
        installationId: "inst_git_1",
        status: "ready",
      },
    });
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      {
        kind: "fetch",
        input: "https://installer.internal/v1/installation-projections",
        method: "POST",
        authorization: "Bearer install-token",
        body: {
          accountId: "acct_operator",
          spaceId: "space-1",
          createdBySubject: "operator-subject",
          source: {
            kind: "git",
            url: "https://github.com/example/app.git",
            ref: "v1.2.3",
          },
          expected: {
            commit: "1111111111111111111111111111111111111111",
            planDigest: "sha256:abc",
          },
          mode: "shared-cell",
          costAck: true,
        },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route applies Git URL install with same-origin Accounts session", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  appInstallationsRouteDeps.handleAccountsPlaneRequest = async (request) => {
    const url = new URL(request.url);
    const body =
      request.method === "POST" ? JSON.parse(await request.text()) : null;
    calls.push({
      kind: "accounts",
      path: url.pathname,
      method: request.method,
      cookie: request.headers.get("cookie"),
      body,
    });
    if (url.pathname === "/v1/account/session/me") {
      return Response.json({
        subject: "tsub_owner",
        expiresAt: 1_767_225_600_000,
      });
    }
    if (
      url.pathname === "/v1/installation-projections" &&
      request.method === "POST"
    ) {
      return Response.json(
        {
          ok: true,
          accounts: {
            installationId: "inst_session_1",
            status: "ready",
          },
        },
        { status: 202 },
      );
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  };

  try {
    const response = await createApp().request(
      "/spaces/space-alias/app-installations/git-url/apply",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "takosumi_session=sess_owner",
        },
        body: JSON.stringify({
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.3",
          module_path: ".",
          mode: "shared-cell",
          expected: {
            planRunId: "run_plan_1",
            runnerProfileId: "runner_default",
            sourceDigest: "sha256:source",
            variablesDigest: "sha256:variables",
            policyDecisionDigest: "sha256:policy",
            planDigest: "sha256:abc",
            planArtifactDigest: "sha256:artifact",
          },
          variables: {
            worker_name: "example-app",
          },
        }),
      },
      { DB: {} } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 202);
    assertObjectMatch(body, {
      ok: true,
      accounts: {
        installationId: "inst_session_1",
        status: "ready",
      },
    });
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      {
        kind: "accounts",
        path: "/v1/account/session/me",
        method: "GET",
        cookie: "takosumi_session=sess_owner",
        body: null,
      },
      {
        kind: "accounts",
        path: "/v1/installation-projections",
        method: "POST",
        cookie: "takosumi_session=sess_owner",
        body: {
          accountId: "space-1",
          workspaceId: "space-1",
          spaceId: "space-1",
          createdBySubject: "tsub_owner",
          source: {
            kind: "git",
            url: "https://github.com/example/app.git",
            ref: "v1.2.3",
            modulePath: ".",
          },
          expected: {
            planRunId: "run_plan_1",
            runnerProfileId: "runner_default",
            sourceDigest: "sha256:source",
            variablesDigest: "sha256:variables",
            policyDecisionDigest: "sha256:policy",
            planDigest: "sha256:abc",
            planArtifactDigest: "sha256:artifact",
          },
          vars: {
            worker_name: "example-app",
          },
          mode: "shared-cell",
        },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route proxies Git URL deployment plan Run and apply", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  installableAppInstallDeps.fetch = async (input, init) => {
    const inputUrl = String(input);
    if (init?.method === "GET") {
      const url = new URL(inputUrl);
      calls.push({
        kind: "fetch",
        input: `${url.origin}${url.pathname}`,
        method: "GET",
        authorization: new Headers(init?.headers).get("authorization"),
        body: null,
      });
      return Response.json({
        installations: [{ id: "inst_1", app_id: "jp.takos.docs" }],
      });
    }
    const isMutation =
      inputUrl.endsWith("/deployments") || inputUrl.endsWith("/rollback");
    calls.push({
      kind: "fetch",
      input: inputUrl,
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json(
      {
        ok: true,
        kind: isMutation
          ? "takosumi.deployment-apply@v1"
          : "takosumi.deployment-plan-run@v1",
      },
      { status: isMutation ? 202 : 200 },
    );
  };

  try {
    const app = createApp();
    const env = {
      DB: {},
      TAKOS_APP_INSTALLATIONS_URL:
        "https://installer.internal/v1/installation-projections",
      TAKOS_APP_INSTALL_TOKEN: "install-token",
      TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.internal",
      TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
    } as Env;

    const planResponse = await app.request(
      "/spaces/space-alias/app-installations/git-url/revision/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "upgrade",
          installation_id: "inst_1",
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.4",
        }),
      },
      env,
    );
    const applyResponse = await app.request(
      "/spaces/space-alias/app-installations/git-url/revision/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          installation_id: "inst_1",
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.3",
          source_commit: "1111111111111111111111111111111111111111",
          reason: "operator rollback",
        }),
      },
      env,
    );

    assertEquals(planResponse.status, 200);
    assertEquals(applyResponse.status, 202);
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      {
        kind: "fetch",
        input: "https://accounts.internal/v1/installation-projections",
        method: "GET",
        authorization: "Bearer accounts-token",
        body: null,
      },
      {
        kind: "fetch",
        input:
          "https://installer.internal/v1/installation-projections/inst_1/deployments/plan-runs",
        method: "POST",
        authorization: "Bearer install-token",
        body: {
          source: {
            kind: "git",
            url: "https://github.com/example/app.git",
            ref: "v1.2.4",
          },
        },
      },
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      {
        kind: "fetch",
        input: "https://accounts.internal/v1/installation-projections",
        method: "GET",
        authorization: "Bearer accounts-token",
        body: null,
      },
      {
        kind: "fetch",
        input:
          "https://installer.internal/v1/installation-projections/inst_1/rollback",
        method: "POST",
        authorization: "Bearer install-token",
        body: {
          deploymentId: "v1.2.3",
          reason: "operator rollback",
        },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route lists and deletes through Takosumi Accounts", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  installableAppInstallDeps.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      kind: "fetch",
      pathname: url.pathname,
      spaceId: url.searchParams.get("space_id"),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (init?.method === "DELETE") {
      return Response.json({
        installation: { id: "inst_1", status: "suspended" },
      });
    }
    if (url.pathname.endsWith("/inst_1")) {
      // Deploy decision D3: workload services are projected from the
      // installation deployment-output projection (the `/services` endpoint
      // was retired).
      return Response.json({
        installation: {
          id: "inst_1",
          deployment_outputs: [
            {
              name: "launch_url",
              kind: "launch_url",
              value: "https://app.example.test",
              sensitive: false,
            },
          ],
        },
      });
    }
    return Response.json({
      installations: [
        {
          id: "inst_1",
          app_id: "jp.takos.docs",
          status: "ready",
        },
      ],
    });
  };

  try {
    const app = createApp();
    const env = {
      DB: {},
      TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.internal",
      TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
    } as Env;

    const listResponse = await app.request(
      "/spaces/space-alias/app-installations",
      { method: "GET" },
      env,
    );
    const deleteResponse = await app.request(
      "/spaces/space-alias/app-installations/inst_1",
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "user removed app" }),
      },
      env,
    );

    assertEquals(listResponse.status, 200);
    assertEquals(deleteResponse.status, 200);
    const listBody = (await listResponse.json()) as {
      installations: Array<{ services?: unknown }>;
    };
    assertEquals(listBody.installations[0]?.services, [
      {
        id: "launch_url",
        capability: "deployment.outputs",
        status: "ready",
        endpoint: "https://app.example.test",
        secret_configured: false,
        token_expires_at: null,
      },
    ]);
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor", "viewer"],
      },
      {
        kind: "fetch",
        pathname: "/v1/installation-projections",
        spaceId: "space-1",
        method: "GET",
        authorization: "Bearer accounts-token",
        body: null,
      },
      {
        kind: "fetch",
        pathname: "/v1/installation-projections/inst_1",
        spaceId: null,
        method: "GET",
        authorization: "Bearer accounts-token",
        body: null,
      },
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      {
        kind: "fetch",
        pathname: "/v1/installation-projections",
        spaceId: "space-1",
        method: "GET",
        authorization: "Bearer accounts-token",
        body: null,
      },
      {
        kind: "fetch",
        pathname: "/v1/installation-projections/inst_1",
        spaceId: null,
        method: "DELETE",
        authorization: "Bearer accounts-token",
        body: { reason: "user removed app" },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route lists Installation services through Takosumi Accounts", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "viewer" },
    } as never;
  };
  installableAppInstallDeps.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      kind: "fetch",
      pathname: url.pathname,
      spaceId: url.searchParams.get("space_id"),
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (url.pathname.endsWith("/inst_1")) {
      return Response.json({
        installation: {
          id: "inst_1",
          deployment_outputs: [
            {
              name: "launch_url",
              kind: "launch_url",
              value: "https://app.example.test",
              sensitive: false,
            },
          ],
        },
      });
    }
    return Response.json({
      installations: [{ id: "inst_1", app_id: "jp.takos.docs" }],
    });
  };

  try {
    const response = await createApp().request(
      "/spaces/space-alias/app-installations/inst_1/services",
      { method: "GET" },
      {
        DB: {},
        TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.internal",
        TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
      } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 200);
    assertEquals(body, {
      installation_id: "inst_1",
      services: [
        {
          id: "launch_url",
          capability: "deployment.outputs",
          status: "ready",
          endpoint: "https://app.example.test",
          secret_configured: false,
          token_expires_at: null,
        },
      ],
    });
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor", "viewer"],
      },
      {
        kind: "fetch",
        pathname: "/v1/installation-projections",
        spaceId: "space-1",
        method: "GET",
        authorization: "Bearer accounts-token",
      },
      {
        kind: "fetch",
        pathname: "/v1/installation-projections/inst_1",
        spaceId: null,
        method: "GET",
        authorization: "Bearer accounts-token",
      },
    ]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route rejects cross-space installation_id with 404", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: "space-1" }, membership: { role: "editor" } }) as never;
  // The authorized space owns no Installation matching the supplied id.
  appInstallationsRouteDeps.listInstallableAppInstallations = async (
    spaceId,
  ) => {
    calls.push({ kind: "list", spaceId });
    return {
      status: 200,
      body: { installations: [{ id: "inst_other_space" }] },
    };
  };
  installableAppInstallDeps.fetch = async () => {
    calls.push({ kind: "fetch" });
    return Response.json({ ok: true });
  };

  try {
    const env = {
      DB: {},
      TAKOS_APP_INSTALLATIONS_URL:
        "https://installer.internal/v1/installation-projections",
      TAKOS_APP_INSTALL_TOKEN: "install-token",
      TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.internal",
      TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
    } as Env;

    const response = await createApp().request(
      "/spaces/space-alias/app-installations/git-url/revision/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          installation_id: "inst_victim",
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.3",
        }),
      },
      env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 404);
    assertObjectMatch(body, {
      error: { code: "NOT_FOUND" },
    });
    // The upstream revision fetch must not have run.
    assertEquals(calls, [{ kind: "list", spaceId: "space-1" }]);
  } finally {
    restoreDeps();
  }
});

test("app-installations route requires Git URL install approval evidence", async () => {
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: "space-1" }, membership: { role: "editor" } }) as never;

  try {
    const response = await createApp().request(
      "/spaces/space-1/app-installations/git-url/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.3",
          cost_ack: true,
        }),
      },
      { DB: {} } as Env,
    );
    const body = (await response.json()) as Record<PropertyKey, unknown>;

    assertEquals(response.status, 400);
    assertObjectMatch(body, {
      error: {
        code: "BAD_REQUEST",
        message: "expected guard is required after install plan Run approval",
      },
    });
  } finally {
    restoreDeps();
  }
});
