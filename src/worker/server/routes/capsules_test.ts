import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { isAppError } from "@takos/worker-platform-utils/errors";

import capsulesRouter, {
  capsulesRouteDeps,
} from "./capsules.ts";
import { routeAuthDeps } from "./route-auth.ts";
import type { Env } from "../../shared/types/index.ts";
import type {
  FeaturedAppCatalogEntry,
} from "../../application/services/source/featured-app-catalog.ts";

const originalRouteAuthDeps = { ...routeAuthDeps };
const originalDeps = { ...capsulesRouteDeps };

afterEach(() => {
  Object.assign(routeAuthDeps, originalRouteAuthDeps);
  Object.assign(capsulesRouteDeps, originalDeps);
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
  app.route("/", capsulesRouter);
  return app;
}

function authorize(spaceId = "space-local") {
  routeAuthDeps.requireSpaceAccess = async () =>
    ({ space: { id: spaceId }, membership: { role: "editor" } }) as never;
}

const operatorEnv = {
  DB: {},
  TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://operator.test/control",
  TAKOSUMI_ACCOUNTS_TOKEN: "operator-token",
  TAKOS_APP_INSTALL_ACCOUNT_ID: "ws_operator",
} as Env;

const delegatedEnv = {
  DB: {},
  ENCRYPTION_KEY: "encryption-key",
  OIDC_ISSUER_URL: "https://operator.test",
  OIDC_CLIENT_ID: "takos",
} as Env;

function authorizeDelegated(workspaceId = "ws_operator") {
  capsulesRouteDeps.accountsDelegatedAuthorization = async () => ({
    accessToken: "delegated-token",
    workspaceId,
    subjectId: "pairwise-user",
  });
  capsulesRouteDeps.resolveInstallableAppAccountsConfig = () => ({
    baseUrl: "https://operator.test/control",
  });
}

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

describe("Capsule routes on canonical Takosumi records", () => {
  test("never falls back to a deployment-wide operator token on HTTP", async () => {
    authorize();
    capsulesRouteDeps.resolveFeaturedAppCatalogForBootstrap =
      async () => [featuredAppEntry];
    let call: unknown;

    const response = await createApp().request(
      "/spaces/me/capsules/apply",
      {
        method: "POST",
        body: JSON.stringify({
          app_id: "jp.takos.office",
          mode: "shared-cell",
        }),
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "install-http-1",
        },
      },
      operatorEnv,
    );
    expect(response.status).toBe(401);
    expect(call).toBeUndefined();
  });

  test("featured Capsule HTTP uses delegated auth and the stable plan key", async () => {
    authorize();
    authorizeDelegated();
    capsulesRouteDeps.resolveFeaturedAppCatalogForBootstrap =
      async () => [featuredAppEntry];
    const calls: unknown[] = [];
    capsulesRouteDeps.planInstallableAppCapsule = async (input) => {
      calls.push({ kind: "plan", input });
      return {
        status: 201,
        body: {
          expected: {
            workspaceId: "ws_operator",
            sourceId: "src_office",
            capsuleId: "cap_office",
            runId: "run_office_plan",
          },
          capsule: { id: "cap_office", status: "planning" },
        },
      };
    };
    capsulesRouteDeps.approveAndApplyInstallableAppCapsule = async (input) => {
      calls.push({ kind: "apply", input });
      return {
        status: 202,
        body: { capsule: { id: "cap_office", status: "active" } },
      };
    };
    const response = await createApp().request(
      "/spaces/me/capsules/apply",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "featured-http-1",
        },
        body: JSON.stringify({ app_id: featuredAppEntry.appId }),
      },
      delegatedEnv,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      subject_source: "oauth_access_token",
      capsule: { capsule_id: "cap_office", status: "active" },
    });
    expect(calls).toEqual([
      {
        kind: "plan",
        input: {
          workspaceId: "ws_operator",
          appId: featuredAppEntry.appId,
          gitUrl: featuredAppEntry.repositoryUrl,
          ref: featuredAppEntry.ref,
          idempotencyKey: "featured-http-1",
        },
      },
      {
        kind: "apply",
        input: {
          workspaceId: "ws_operator",
          expected: {
            workspaceId: "ws_operator",
            sourceId: "src_office",
            capsuleId: "cap_office",
            runId: "run_office_plan",
          },
        },
      },
    ]);
  });

  test("passes an exact canonical Run reference from plan to apply", async () => {
    authorize();
    authorizeDelegated();
    const calls: unknown[] = [];
    capsulesRouteDeps.planInstallableAppCapsule = async (
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
    capsulesRouteDeps.approveAndApplyInstallableAppCapsule = async (
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
      "/spaces/me/capsules/git-url/plan",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "install-http-2",
        },
        body: JSON.stringify(source),
      },
      delegatedEnv,
    );
    const plan = (await planResponse.json()) as Record<string, unknown>;
    const applyResponse = await app.request(
      "/spaces/me/capsules/git-url/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...source, expected: plan.expected }),
      },
      delegatedEnv,
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
          idempotencyKey: "install-http-2",
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
    capsulesRouteDeps.accountsDelegatedAuthorization = async () => ({
      accessToken: "delegated-token",
      workspaceId: "ws_parent",
      subjectId: "pairwise-user",
    });
    capsulesRouteDeps.resolveInstallableAppAccountsConfig = () => ({
      baseUrl: "https://operator.test",
    });
    let planned: unknown;
    capsulesRouteDeps.planInstallableAppCapsule = async (
      input,
      config,
    ) => {
      planned = { input, headers: new Headers(config.headers) };
      return { status: 201, body: { expected: { runId: "run_1" } } };
    };
    const response = await createApp().request(
      "/spaces/me/capsules/git-url/plan",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "install-http-3",
        },
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
    capsulesRouteDeps.resolveInstallableAppAccountsConfig = () => ({
      baseUrl: "https://operator.test",
    });
    capsulesRouteDeps.accountsPlaneFetch = async () =>
      Response.json({ subject: "tsub_user" });
    const response = await createApp().request(
      "/spaces/me/capsules",
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

  test("forwards only the exact Takosumi session cookie to Accounts", async () => {
    authorize();
    capsulesRouteDeps.resolveInstallableAppAccountsConfig = () => ({
      baseUrl: "https://operator.test",
    });
    let forwardedCookie: string | null = null;
    let requestedPath: string | null = null;
    capsulesRouteDeps.accountsPlaneFetch = async (request) => {
      forwardedCookie = request.headers.get("cookie");
      requestedPath = new URL(request.url).pathname;
      return Response.json({ subject: "tsub_user" });
    };
    const response = await createApp().request(
      "/spaces/me/capsules",
      {
        headers: {
          cookie:
            "analytics_id=private-analytics; takosumi_session=sess_current; theme=dark",
        },
      },
      { DB: {} } as Env,
    );
    expect(response.status).toBe(401);
    expect(forwardedCookie).toBe("takosumi_session=sess_current");
    expect(requestedPath).toBe("/api/v1/account/session/me");
  });

  test("plans rollback from a StateVersion and applies its exact Run", async () => {
    authorize();
    authorizeDelegated();
    capsulesRouteDeps.listInstallableAppCapsules = async () => ({
      status: 200,
      body: { capsules: [{ capsule_id: "cap_1" }] },
    });
    const calls: unknown[] = [];
    capsulesRouteDeps.planInstallableAppRevision = async (input) => {
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
    capsulesRouteDeps.approveAndApplyInstallableAppRevision = async (input) => {
      calls.push({ kind: "apply", input });
      return { status: 202, body: { run: { id: "run_restore" } } };
    };
    const app = createApp();
    const planResponse = await app.request(
      "/spaces/me/capsules/git-url/revision/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          capsule_id: "cap_1",
          state_version_id: "sv_1",
        }),
      },
      delegatedEnv,
    );
    const plan = (await planResponse.json()) as Record<string, unknown>;
    const applyResponse = await app.request(
      "/spaces/me/capsules/git-url/revision/apply",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          capsule_id: "cap_1",
          state_version_id: "sv_1",
          expected: plan.expected,
        }),
      },
      delegatedEnv,
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

  test("requires and forwards a caller-owned idempotency key for upgrade", async () => {
    authorize();
    authorizeDelegated();
    capsulesRouteDeps.listInstallableAppCapsules = async () => ({
      status: 200,
      body: { capsules: [{ capsule_id: "cap_1" }] },
    });
    const calls: unknown[] = [];
    capsulesRouteDeps.planInstallableAppRevision = async (input) => {
      calls.push(input);
      return {
        status: 201,
        body: {
          expected: {
            workspaceId: "ws_operator",
            sourceId: "src_1",
            capsuleId: "cap_1",
            runId: "run_upgrade",
          },
        },
      };
    };
    const app = createApp();
    const missingKey = await app.request(
      "/spaces/me/capsules/git-url/revision/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "upgrade",
          capsule_id: "cap_1",
          ref: "release/v2",
          git_url: "https://ignored.example/legacy.git",
        }),
      },
      delegatedEnv,
    );
    expect(missingKey.status).toBe(400);
    expect(calls).toHaveLength(0);

    const response = await app.request(
      "/spaces/me/capsules/git-url/revision/plan",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "revision-http-1",
        },
        body: JSON.stringify({
          operation: "upgrade",
          capsule_id: "cap_1",
          ref: "release/v2",
          git_url: "https://ignored.example/legacy.git",
        }),
      },
      delegatedEnv,
    );
    expect(response.status).toBe(201);
    expect(calls).toEqual([
      {
        workspaceId: "ws_operator",
        capsuleId: "cap_1",
        operation: "upgrade",
        ref: "release/v2",
        idempotencyKey: "revision-http-1",
      },
    ]);
  });

  test("lists, reads services, and deletes only canonical Capsule ids", async () => {
    authorize();
    authorizeDelegated();
    capsulesRouteDeps.listInstallableAppCapsulesWithServices =
      async (workspaceId) => ({
        status: 200,
        body: { workspaceId, capsules: [{ capsule_id: "cap_1" }] },
      });
    capsulesRouteDeps.listInstallableAppCapsules = async () => ({
      status: 200,
      body: { capsules: [{ capsule_id: "cap_1" }] },
    });
    capsulesRouteDeps.listInstallableAppCapsuleServices = async (
      capsuleId,
      workspaceId,
    ) => ({
      status: 200,
      body: { capsuleId, workspaceId, services: [] },
    });
    capsulesRouteDeps.deleteInstallableAppCapsule = async (
      capsuleId,
      workspaceId,
    ) => ({
      status: 202,
      body: {
        run: { id: "run_destroy", workspaceId, capsuleId },
        expected: { workspaceId, capsuleId, runId: "run_destroy" },
      },
    });
    const app = createApp();
    const listed = await app.request(
      "/spaces/me/capsules",
      {},
      delegatedEnv,
    );
    const services = await app.request(
      "/spaces/me/capsules/cap_1/services",
      {},
      delegatedEnv,
    );
    const deleted = await app.request(
      "/spaces/me/capsules/cap_1",
      { method: "DELETE" },
      delegatedEnv,
    );
    expect(await listed.json()).toMatchObject({ workspaceId: "ws_operator" });
    expect(await services.json()).toMatchObject({
      capsuleId: "cap_1",
      workspaceId: "ws_operator",
    });
    expect(await deleted.json()).toMatchObject({
      run: { id: "run_destroy", workspaceId: "ws_operator", capsuleId: "cap_1" },
      expected: { workspaceId: "ws_operator", capsuleId: "cap_1", runId: "run_destroy" },
    });
  });

  test("rejects a cross-Workspace Capsule id before revision mutation", async () => {
    authorize();
    authorizeDelegated();
    capsulesRouteDeps.listInstallableAppCapsules = async () => ({
      status: 200,
      body: { capsules: [{ capsule_id: "cap_owned" }] },
    });
    let mutated = false;
    capsulesRouteDeps.planInstallableAppRevision = async () => {
      mutated = true;
      return { status: 201, body: {} };
    };
    const response = await createApp().request(
      "/spaces/me/capsules/git-url/revision/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "rollback",
          capsule_id: "cap_foreign",
          state_version_id: "sv_1",
        }),
      },
      delegatedEnv,
    );
    expect(response.status).toBe(404);
    expect(mutated).toBe(false);
  });

  test("interactive Capsule routes reject static operator configuration", async () => {
    authorize("space-other");
    let listed = false;
    capsulesRouteDeps.listInstallableAppCapsulesWithServices =
      async () => {
        listed = true;
        return {
          status: 200,
          body: { capsules: [{ capsule_id: "cap_1" }] },
        };
      };
    let deleted = false;
    capsulesRouteDeps.deleteInstallableAppCapsule = async () => {
      deleted = true;
      return { status: 202, body: {} };
    };
    const app = createApp();
    const listResponse = await app.request(
      "/spaces/space-other/capsules",
      {},
      operatorEnv,
    );
    const deleteResponse = await app.request(
      "/spaces/space-other/capsules/cap_1",
      { method: "DELETE" },
      operatorEnv,
    );
    expect(listResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(listed).toBe(false);
    expect(deleted).toBe(false);
  });

  test("requires exact Run evidence for apply", async () => {
    authorize();
    const response = await createApp().request(
      "/spaces/me/capsules/git-url/apply",
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

  test("rejects a missing or overlong caller-owned idempotency key", async () => {
    authorize();
    authorizeDelegated();
    let planned = false;
    capsulesRouteDeps.planInstallableAppCapsule = async () => {
      planned = true;
      return { status: 201, body: {} };
    };
    const response = await createApp().request(
      "/spaces/me/capsules/git-url/plan",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          git_url: "https://github.com/acme/app.git",
          ref: "main",
        }),
      },
      delegatedEnv,
    );
    expect(response.status).toBe(400);
    const oversized = await createApp().request(
      "/spaces/me/capsules/git-url/plan",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": "x".repeat(257),
        },
        body: JSON.stringify({
          git_url: "https://github.com/acme/app.git",
          ref: "main",
        }),
      },
      delegatedEnv,
    );
    expect(oversized.status).toBe(400);
    expect(planned).toBe(false);
  });
});
