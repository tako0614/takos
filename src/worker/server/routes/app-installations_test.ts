import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { isAppError } from "@takos/worker-platform-utils/errors";

import appInstallationsRouter, {
  appInstallationsRouteDeps,
} from "./app-installations.ts";
import { routeAuthDeps } from "./route-auth.ts";
import type { Env } from "../../shared/types/index.ts";
import type {
  FeaturedAppCatalogEntry,
  FeaturedAppInstallConfig,
} from "../../application/services/source/featured-app-catalog.ts";

const originalRouteAuthDeps = { ...routeAuthDeps };
const originalDeps = { ...appInstallationsRouteDeps };

afterEach(() => {
  Object.assign(routeAuthDeps, originalRouteAuthDeps);
  Object.assign(appInstallationsRouteDeps, originalDeps);
});

function createApp() {
  const app = new Hono<{
    Bindings: Env;
    Variables: { user: { id: string } };
  }>();
  app.onError((error, c) => {
    if (isAppError(error)) {
      return c.json(error.toResponse(), error.statusCode as never);
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

function authorize(spaceId = "space-local") {
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: spaceId }, membership: { role: "editor" } }) as never;
}

const operatorEnv = {
  DB: {},
  TAKOS_APP_INSTALLATIONS_URL: "https://operator.test/control",
  TAKOS_APP_INSTALL_TOKEN: "operator-token",
  TAKOS_APP_INSTALL_ACCOUNT_ID: "ws_operator",
} as Env;

const featuredAppEntry = {
  name: "takos-office",
  title: "Office",
  appId: "jp.takos.office",
  repositoryUrl: "https://github.com/tako0614/takos-office.git",
  ref: "v1.0.0",
  refType: "tag",
  runtimeModes: ["shared-cell", "dedicated"],
  preinstall: false,
} satisfies FeaturedAppCatalogEntry;

const featuredConfig = {
  controlUrl: "https://operator.test/control",
  token: "operator-token",
  workspaceId: "ws_operator",
  mode: "shared-cell",
} satisfies FeaturedAppInstallConfig;

describe("app installation routes on canonical Takosumi records", () => {
  test("applies a featured app through explicit operator automation", async () => {
    authorize();
    appInstallationsRouteDeps.resolveFeaturedAppCatalogForBootstrap =
      async () => [featuredAppEntry];
    appInstallationsRouteDeps.resolveFeaturedAppInstallConfig = () =>
      featuredConfig;
    let call: unknown;
    appInstallationsRouteDeps.applyFeaturedAppInstallation = async (
      entry,
      config,
      params,
    ) => {
      call = { entry, config, params };
      return { capsule: { id: "cap_office", status: "active" } };
    };

    const response = await createApp().request(
      "/spaces/me/app-installations/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app_id: "jp.takos.office",
          mode: "shared-cell",
        }),
      },
      operatorEnv,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      installation: {
        installation_id: "cap_office",
        status: "ready",
        app_id: "jp.takos.office",
      },
      subject_source: "operator_config",
    });
    expect(call).toEqual({
      entry: featuredAppEntry,
      config: featuredConfig,
      params: { mode: "shared-cell" },
    });
  });

  test("passes an exact canonical Run reference from plan to apply", async () => {
    authorize();
    const calls: unknown[] = [];
    appInstallationsRouteDeps.planInstallableAppInstallation = async (
      input,
    ) => {
      calls.push({ kind: "plan", input });
      return {
        status: 201,
        body: {
          expected: {
            workspaceId: "ws_operator",
            sourceId: "src_1",
            capsuleId: "cap_1",
            runId: "run_plan",
          },
        },
      };
    };
    appInstallationsRouteDeps.applyInstallableAppInstallation = async (
      input,
    ) => {
      calls.push({ kind: "apply", input });
      return { status: 202, body: { run: { id: "run_apply" } } };
    };
    const app = createApp();
    const source = {
      git_url: "https://github.com/acme/app.git",
      ref: "v1",
      module_path: "modules/app",
    };
    const planResponse = await app.request(
      "/spaces/me/app-installations/git-url/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source),
      },
      operatorEnv,
    );
    const plan = (await planResponse.json()) as Record<string, unknown>;
    const applyResponse = await app.request(
      "/spaces/me/app-installations/git-url/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...source, expected: plan.expected }),
      },
      operatorEnv,
    );
    expect(planResponse.status).toBe(201);
    expect(applyResponse.status).toBe(202);
    expect(calls).toEqual([
      {
        kind: "plan",
        input: {
          workspaceId: "ws_operator",
          gitUrl: source.git_url,
          ref: "v1",
          modulePath: "modules/app",
        },
      },
      {
        kind: "apply",
        input: {
          workspaceId: "ws_operator",
          expected: {
            workspaceId: "ws_operator",
            sourceId: "src_1",
            capsuleId: "cap_1",
            runId: "run_plan",
          },
        },
      },
    ]);
  });

  test("uses the delegated Takosumi Workspace instead of the local id", async () => {
    authorize("local-space");
    appInstallationsRouteDeps.accountsDelegatedAuthorization = async () => ({
      accessToken: "delegated-token",
      workspaceId: "ws_parent",
    });
    appInstallationsRouteDeps.resolveInstallableAppAccountsConfig = () => ({
      baseUrl: "https://operator.test",
    });
    let planned: unknown;
    appInstallationsRouteDeps.planInstallableAppInstallation = async (
      input,
      config,
    ) => {
      planned = { input, headers: new Headers(config.headers) };
      return { status: 201, body: { expected: { runId: "run_1" } } };
    };
    const response = await createApp().request(
      "/spaces/me/app-installations/git-url/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          git_url: "https://github.com/acme/app.git",
          ref: "main",
        }),
      },
      {
        DB: {},
        ENCRYPTION_KEY: "encryption-key",
        OIDC_ISSUER_URL: "https://operator.test",
        OIDC_CLIENT_ID: "takos",
      } as Env,
    );
    expect(response.status).toBe(201);
    expect(planned).toMatchObject({
      input: { workspaceId: "ws_parent" },
    });
    expect((planned as { headers: Headers }).headers.get("authorization")).toBe(
      "Bearer delegated-token",
    );
  });

  test("raw Accounts session without Workspace delegation fails closed", async () => {
    authorize();
    appInstallationsRouteDeps.resolveInstallableAppAccountsConfig = () => ({
      baseUrl: "https://operator.test",
    });
    appInstallationsRouteDeps.accountsPlaneFetch = async () =>
      Response.json({ subject: "tsub_user" });
    const response = await createApp().request(
      "/spaces/me/app-installations",
      {
        headers: { "x-takosumi-account-session": "sess_current" },
      },
      { DB: {} } as Env,
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: {
        message: "Takosumi Workspace-bound OAuth authorization is required",
      },
    });
  });

  test("plans rollback from a StateVersion and applies its exact Run", async () => {
    authorize();
    appInstallationsRouteDeps.listInstallableAppInstallations = async () => ({
      status: 200,
      body: { installations: [{ id: "cap_1" }] },
    });
    const calls: unknown[] = [];
    appInstallationsRouteDeps.planInstallableAppRevision = async (input) => {
      calls.push({ kind: "plan", input });
      return {
        status: 201,
        body: {
          expected: {
            workspaceId: "ws_operator",
            capsuleId: "cap_1",
            runId: "run_rollback",
          },
        },
      };
    };
    appInstallationsRouteDeps.applyInstallableAppRevision = async (input) => {
      calls.push({ kind: "apply", input });
      return { status: 202, body: { run: { id: "run_restore" } } };
    };
    const app = createApp();
    const planResponse = await app.request(
      "/spaces/me/app-installations/git-url/revision/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          installation_id: "cap_1",
          state_version_id: "sv_1",
        }),
      },
      operatorEnv,
    );
    const plan = (await planResponse.json()) as Record<string, unknown>;
    const applyResponse = await app.request(
      "/spaces/me/app-installations/git-url/revision/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          installation_id: "cap_1",
          state_version_id: "sv_1",
          expected: plan.expected,
        }),
      },
      operatorEnv,
    );
    expect(planResponse.status).toBe(201);
    expect(applyResponse.status).toBe(202);
    expect(calls).toEqual([
      {
        kind: "plan",
        input: {
          workspaceId: "ws_operator",
          capsuleId: "cap_1",
          operation: "rollback",
          ref: "sv_1",
        },
      },
      {
        kind: "apply",
        input: {
          workspaceId: "ws_operator",
          capsuleId: "cap_1",
          operation: "rollback",
          expected: {
            workspaceId: "ws_operator",
            capsuleId: "cap_1",
            runId: "run_rollback",
          },
        },
      },
    ]);
  });

  test("lists, reads services, and deletes only canonical Capsule ids", async () => {
    authorize();
    appInstallationsRouteDeps.listInstallableAppInstallationsWithServices =
      async (workspaceId) => ({
        status: 200,
        body: { workspaceId, installations: [{ id: "cap_1" }] },
      });
    appInstallationsRouteDeps.listInstallableAppInstallations = async () => ({
      status: 200,
      body: { installations: [{ id: "cap_1" }] },
    });
    appInstallationsRouteDeps.listInstallableAppInstallationServices = async (
      capsuleId,
      workspaceId,
    ) => ({
      status: 200,
      body: { capsuleId, workspaceId, services: [] },
    });
    appInstallationsRouteDeps.deleteInstallableAppInstallation = async (
      capsuleId,
      workspaceId,
    ) => ({ status: 202, body: { capsuleId, workspaceId } });
    const app = createApp();
    const listed = await app.request(
      "/spaces/me/app-installations",
      {},
      operatorEnv,
    );
    const services = await app.request(
      "/spaces/me/app-installations/cap_1/services",
      {},
      operatorEnv,
    );
    const deleted = await app.request(
      "/spaces/me/app-installations/cap_1",
      { method: "DELETE" },
      operatorEnv,
    );
    expect(await listed.json()).toMatchObject({ workspaceId: "ws_operator" });
    expect(await services.json()).toMatchObject({
      capsuleId: "cap_1",
      workspaceId: "ws_operator",
    });
    expect(await deleted.json()).toEqual({
      capsuleId: "cap_1",
      workspaceId: "ws_operator",
    });
  });

  test("rejects a cross-Workspace Capsule id before revision mutation", async () => {
    authorize();
    appInstallationsRouteDeps.listInstallableAppInstallations = async () => ({
      status: 200,
      body: { installations: [{ id: "cap_owned" }] },
    });
    let mutated = false;
    appInstallationsRouteDeps.planInstallableAppRevision = async () => {
      mutated = true;
      return { status: 201, body: {} };
    };
    const response = await createApp().request(
      "/spaces/me/app-installations/git-url/revision/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          installation_id: "cap_foreign",
          state_version_id: "sv_1",
        }),
      },
      operatorEnv,
    );
    expect(response.status).toBe(404);
    expect(mutated).toBe(false);
  });

  test("requires exact Run evidence for apply", async () => {
    authorize();
    const response = await createApp().request(
      "/spaces/me/app-installations/git-url/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          git_url: "https://github.com/acme/app.git",
          ref: "main",
        }),
      },
      operatorEnv,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        message: "expected exact Run reference is required after Capsule plan",
      },
    });
  });
});
