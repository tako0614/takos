import { assertEquals, assertObjectMatch } from "@std/assert";
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
  const app = new Hono<
    { Bindings: Env; Variables: { user: { id: string } } }
  >();
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
  installUrl: "https://installer.internal/v1/installations",
  token: "install-token",
  subject: "operator-subject",
  mode: "shared-cell",
} satisfies DefaultAppInstallConfig;

Deno.test("app-installations route applies a default app through Installation", async () => {
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
  appInstallationsRouteDeps.resolveTakosumiSubject = async (_env, userId) => {
    calls.push({ kind: "subject", userId });
    return "takosumi-user-subject";
  };
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
    const body = await response.json() as Record<PropertyKey, unknown>;

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
      subject_source: "takosumi_oidc",
    });
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor"],
      },
      { kind: "subject", userId: "user-1" },
      {
        kind: "apply",
        entry: defaultAppEntry,
        config: installConfig,
        params: {
          spaceId: "space-1",
          createdByAccountId: "space-1",
          subject: "takosumi-user-subject",
          mode: "shared-cell",
        },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

Deno.test("app-installations route applies catalog-only road-to-me by app_id", async () => {
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
  appInstallationsRouteDeps.resolveTakosumiSubject = async () =>
    "takosumi-user-subject";
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
    const body = await response.json() as Record<PropertyKey, unknown>;

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
      subject_source: "takosumi_oidc",
    });
    assertEquals(calls.at(-1), {
      kind: "apply",
      entry: roadToMeCatalogEntry,
      config: installConfig,
      params: {
        spaceId: "space-1",
        createdByAccountId: "space-1",
        subject: "takosumi-user-subject",
        mode: "dedicated",
      },
    });
  } finally {
    restoreDeps();
  }
});

Deno.test("app-installations route requires Installation install config", async () => {
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
    const body = await response.json() as Record<PropertyKey, unknown>;

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

Deno.test("app-installations route rejects camelCase request aliases", async () => {
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
    const body = await response.json() as Record<PropertyKey, unknown>;

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

Deno.test("app-installations route proxies Git URL install dry-run", async () => {
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
      manifestDigest: "sha256:abc",
      appSpec: { metadata: { id: "example.app" }, components: {} },
      changes: [],
      expected: {
        commit: "1111111111111111111111111111111111111111",
        manifestDigest: "sha256:abc",
      },
    });
  };

  try {
    const response = await createApp().request(
      "/spaces/space-alias/app-installations/git-url/dry-run",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          git_url: "https://github.com/example/app.git",
          ref: "v1.2.3",
        }),
      },
      {
        DB: {},
        TAKOS_APP_INSTALLATIONS_URL:
          "https://installer.internal/v1/installations",
        TAKOS_APP_INSTALL_TOKEN: "install-token",
      } as Env,
    );
    const body = await response.json() as Record<PropertyKey, unknown>;

    assertEquals(response.status, 200);
    assertObjectMatch(body, {
      manifestDigest: "sha256:abc",
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
        input: "https://installer.internal/v1/installations/dry-run",
        method: "POST",
        authorization: "Bearer install-token",
        body: {
          spaceId: "space-1",
          source: {
            kind: "git",
            url: "https://github.com/example/app.git",
            ref: "v1.2.3",
          },
        },
      },
    ]);
  } finally {
    restoreDeps();
  }
});

Deno.test("app-installations route proxies Git URL install apply with approval evidence", async () => {
  const calls: unknown[] = [];
  routeAuthDeps.requireSpaceAccess = async (_c, spaceId, userId, roles) => {
    calls.push({ kind: "access", spaceId, userId, roles });
    return {
      space: { id: "space-1" },
      membership: { role: "editor" },
    } as never;
  };
  appInstallationsRouteDeps.resolveTakosumiSubject = async (_env, userId) => {
    calls.push({ kind: "subject", userId });
    return "takosumi-user-subject";
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
      ok: true,
      kind: "takosumi.installation-apply@v1",
      accounts: {
        installationId: "inst_git_1",
        status: "ready",
      },
    }, { status: 202 });
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
          expected_manifest_digest: "sha256:abc",
          cost_ack: true,
        }),
      },
      {
        DB: {},
        TAKOS_APP_INSTALLATIONS_URL:
          "https://installer.internal/v1/installations",
        TAKOS_APP_INSTALL_TOKEN: "install-token",
        TAKOS_APP_INSTALL_ACCOUNT_ID: "acct_operator",
        TAKOS_APP_INSTALL_SUBJECT: "operator-subject",
      } as Env,
    );
    const body = await response.json() as Record<PropertyKey, unknown>;

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
      { kind: "subject", userId: "user-1" },
      {
        kind: "fetch",
        input: "https://installer.internal/v1/installations",
        method: "POST",
        authorization: "Bearer install-token",
        body: {
          spaceId: "space-1",
          source: {
            kind: "git",
            url: "https://github.com/example/app.git",
            ref: "v1.2.3",
          },
          expected: {
            commit: "1111111111111111111111111111111111111111",
            manifestDigest: "sha256:abc",
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

Deno.test("app-installations route proxies Git URL deployment dry-run and apply", async () => {
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
    const isMutation = inputUrl.endsWith("/deployments") ||
      inputUrl.endsWith("/rollback");
    calls.push({
      kind: "fetch",
      input: inputUrl,
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({
      ok: true,
      kind: isMutation
        ? "takosumi.deployment-apply@v1"
        : "takosumi.deployment-dry-run@v1",
    }, { status: isMutation ? 202 : 200 });
  };

  try {
    const app = createApp();
    const env = {
      DB: {},
      TAKOS_APP_INSTALLATIONS_URL:
        "https://installer.internal/v1/installations",
      TAKOS_APP_INSTALL_TOKEN: "install-token",
    } as Env;

    const dryRunResponse = await app.request(
      "/spaces/space-alias/app-installations/git-url/revision/dry-run",
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

    assertEquals(dryRunResponse.status, 200);
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
        input:
          "https://installer.internal/v1/installations/inst_1/deployments/dry-run",
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
        input: "https://installer.internal/v1/installations/inst_1/rollback",
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

Deno.test("app-installations route lists and deletes through Takosumi Accounts", async () => {
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
    return Response.json({
      installations: [{
        id: "inst_1",
        app_id: "jp.takos.docs",
        status: "ready",
      }],
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
    assertEquals(calls, [
      {
        kind: "access",
        spaceId: "space-alias",
        userId: "user-1",
        roles: ["owner", "admin", "editor", "viewer"],
      },
      {
        kind: "fetch",
        pathname: "/v1/installations",
        spaceId: "space-1",
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
        pathname: "/v1/installations/inst_1",
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

Deno.test("app-installations route requires Git URL install approval evidence", async () => {
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
    const body = await response.json() as Record<PropertyKey, unknown>;

    assertEquals(response.status, 400);
    assertObjectMatch(body, {
      error: {
        code: "BAD_REQUEST",
        message:
          "expected_commit and expected_manifest_digest are required after install dry-run approval",
      },
    });
  } finally {
    restoreDeps();
  }
});
