import { describe, expect, test } from "bun:test";

import {
  approveAndApplyInstallableAppCapsule,
  approveAndApplyInstallableAppRevision,
  applyInstallableAppCapsule,
  applyInstallableAppRevision,
  deleteInstallableAppCapsule,
  installableAppInstallDeps,
  listInstallableAppCapsuleServices,
  listInstallableAppCapsules,
  listInstallableAppCapsulesWithServices,
  planInstallableAppCapsule,
  planInstallableAppRevision,
  resolveInstallableAppInstallConfig,
} from "../installable-app-install.ts";
import {
  TAKOSUMI_API_VERSION,
  UI_SURFACE_INTERFACE_TYPE,
  UI_SURFACE_INTERFACE_VERSION,
} from "takosumi-contract";

type SeenRequest = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
  idempotencyKey: string | null;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function installConfigEnv(
  overrides: Record<string, unknown>,
): Parameters<typeof resolveInstallableAppInstallConfig>[0] {
  return overrides as Parameters<typeof resolveInstallableAppInstallConfig>[0];
}

describe("canonical Capsule install client", () => {
  test("uses canonical Accounts control variables and ignores retired URL/token aliases", () => {
    expect(
      resolveInstallableAppInstallConfig(
        installConfigEnv({
          TAKOS_APP_INSTALLATIONS_URL: "https://legacy.example/control",
          TAKOS_APP_INSTALL_TOKEN: "legacy-token",
          TAKOS_APP_INSTALL_ACCOUNT_ID: "ws_operator",
        }),
      ),
    ).toEqual({ accountId: "ws_operator" });
    expect(
      resolveInstallableAppInstallConfig(
        installConfigEnv({
          TAKOSUMI_ACCOUNTS_INTERNAL_URL: "https://accounts.internal/",
          TAKOSUMI_ACCOUNTS_URL: "https://accounts.example/",
          TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
          TAKOS_APP_INSTALL_ACCOUNT_ID: "ws_operator",
        }),
      ),
    ).toEqual({
      controlUrl: "https://accounts.internal/",
      token: "accounts-token",
      accountId: "ws_operator",
    });
    expect(
      resolveInstallableAppInstallConfig(
        installConfigEnv({
          TAKOSUMI_ACCOUNTS_URL: "https://accounts.example/",
          TAKOSUMI_ACCOUNTS_TOKEN: "accounts-token",
          TAKOS_APP_INSTALL_ACCOUNT_ID: "ws_operator",
        }),
      ),
    ).toEqual({
      controlUrl: "https://accounts.example/",
      token: "accounts-token",
      accountId: "ws_operator",
    });
  });

  test("plans without approval, then explicitly approves and applies the exact Run", async () => {
    const seen: SeenRequest[] = [];
    let runStatus = "waiting_approval";
    let phase:
      | "syncing_source"
      | "compiling_install"
      | "creating_capsule"
      | "planning"
      | "reviewable" = "syncing_source";
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      seen.push({
        method,
        pathname: url.pathname,
        search: url.search,
        body,
        idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
      });
      if (
        method === "POST" &&
        url.pathname === "/control/api/v1/workspaces/ws_1/install-plans"
      ) {
        return json(
          {
            installPlan: {
              id: "gip_1",
              workspaceId: "ws_1",
              createdBy: "subject_1",
              requestDigest: "digest_1",
              source: body.source,
              capsule: body.capsule,
              options: body.options,
              phase,
              generation: 0,
              createdAt: "2026-08-21T00:00:00.000Z",
              updatedAt: "2026-08-21T00:00:00.000Z",
            },
            nextAction: "reconcile",
            links: {
              self: "/api/v1/install-plans/gip_1",
              reconcile: "/api/v1/install-plans/gip_1/reconcile",
            },
          },
          201,
        );
      }
      if (
        method === "GET" &&
        url.pathname === "/control/api/v1/install-plans/gip_1"
      ) {
        return json({
          installPlan: {
            id: "gip_1",
            workspaceId: "ws_1",
            createdBy: "subject_1",
            requestDigest: "digest_1",
            source: {
              name: "office-source",
              url: "https://github.com/acme/office.git",
              ref: "v1.0.0",
              path: ".",
            },
            capsule: { name: "office", environment: "production" },
            options: {},
            phase,
            generation: phase === "syncing_source" ? 0 : 1,
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:00:00.000Z",
            ...(phase === "reviewable"
              ? {
                  sourceId: "src_1",
                  capsuleId: "cap_1",
                  planRunId: "run_plan",
                }
              : {}),
          },
          nextAction: phase === "reviewable" ? "review_run" : "reconcile",
          links: {
            self: "/api/v1/install-plans/gip_1",
            ...(phase === "reviewable"
              ? { run: "/api/v1/runs/run_plan" }
              : { reconcile: "/api/v1/install-plans/gip_1/reconcile" }),
          },
        });
      }
      if (
        method === "POST" &&
        url.pathname === "/control/api/v1/install-plans/gip_1/reconcile"
      ) {
        phase =
          phase === "syncing_source"
            ? "compiling_install"
            : phase === "compiling_install"
              ? "creating_capsule"
              : phase === "creating_capsule"
                ? "planning"
                : "reviewable";
        return json({
          installPlan: {
            id: "gip_1",
            workspaceId: "ws_1",
            createdBy: "subject_1",
            requestDigest: "digest_1",
            source: {
              name: "office-source",
              url: "https://github.com/acme/office.git",
              ref: "v1.0.0",
              path: ".",
            },
            capsule: { name: "office", environment: "production" },
            options: {},
            phase,
            generation: 1,
            createdAt: "2026-08-21T00:00:00.000Z",
            updatedAt: "2026-08-21T00:00:00.000Z",
            ...(phase === "reviewable"
              ? {
                  sourceId: "src_1",
                  capsuleId: "cap_1",
                  planRunId: "run_plan",
                }
              : {}),
          },
          nextAction: phase === "reviewable" ? "review_run" : "reconcile",
          links: {
            self: "/api/v1/install-plans/gip_1",
            ...(phase === "reviewable"
              ? { run: "/api/v1/runs/run_plan" }
              : { reconcile: "/api/v1/install-plans/gip_1/reconcile" }),
          },
        });
      }
      if (
        method === "GET" &&
        url.pathname === "/control/api/v1/runs/run_plan"
      ) {
        return json({
          run: {
            id: "run_plan",
            workspaceId: "ws_1",
            capsuleId: "cap_1",
            type: "plan",
            status: runStatus,
          },
        });
      }
      if (url.pathname === "/control/api/v1/runs/run_plan/approve") {
        runStatus = "succeeded";
        return json({
          run: {
            id: "run_plan",
            workspaceId: "ws_1",
            capsuleId: "cap_1",
            type: "plan",
            status: runStatus,
          },
        });
      }
      if (url.pathname === "/control/api/v1/runs/run_plan/apply") {
        return json({ run: { id: "run_apply", status: "queued" } }, 202);
      }
      return json({ error: "unexpected" }, 500);
    };
    const config = {
      controlUrl: "https://operator.test/control",
      idempotencyKey: "install-test-1",
      fetch,
    };
    const source = {
      workspaceId: "ws_1",
      appId: "office",
      gitUrl: "https://github.com/acme/office.git",
      ref: "v1.0.0",
    };
    const plan = await planInstallableAppCapsule(source, config);
    expect(plan.status).toBe(201);
    expect(seen[0]?.body).toEqual({
      source: {
        name: "office-source",
        url: "https://github.com/acme/office.git",
        ref: "v1.0.0",
        path: ".",
      },
      capsule: { name: "office", environment: "production" },
      options: {},
    });
    expect(seen[0]?.idempotencyKey).toBeString();
    expect(plan.body?.expected).toEqual({
      workspaceId: "ws_1",
      sourceId: "src_1",
      capsuleId: "cap_1",
      runId: "run_plan",
    });
    expect(
      seen.some(({ pathname }) => pathname.endsWith("/approve")),
    ).toBe(false);
    const applied = await approveAndApplyInstallableAppCapsule(
      {
        workspaceId: source.workspaceId,
        expected: plan.body!.expected as Record<string, unknown>,
      },
      config,
    );
    expect(applied.status).toBe(202);
    expect(seen.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual(
      [
        "POST /control/api/v1/workspaces/ws_1/install-plans",
        "GET /control/api/v1/install-plans/gip_1",
        "POST /control/api/v1/install-plans/gip_1/reconcile",
        "GET /control/api/v1/install-plans/gip_1",
        "POST /control/api/v1/install-plans/gip_1/reconcile",
        "GET /control/api/v1/install-plans/gip_1",
        "POST /control/api/v1/install-plans/gip_1/reconcile",
        "GET /control/api/v1/install-plans/gip_1",
        "POST /control/api/v1/install-plans/gip_1/reconcile",
        "GET /control/api/v1/runs/run_plan",
        "GET /control/api/v1/runs/run_plan",
        "POST /control/api/v1/runs/run_plan/approve",
        "GET /control/api/v1/runs/run_plan",
        "POST /control/api/v1/runs/run_plan/apply",
      ],
    );
    expect(
      seen
        .slice(0, 9)
        .map(({ idempotencyKey }) => idempotencyKey)
        .filter((key) => key !== null),
    ).toEqual([seen[0]?.idempotencyKey]);
  });

  test("background apply never approves a waiting Run", async () => {
    const seen: string[] = [];
    const result = await applyInstallableAppCapsule(
      {
        workspaceId: "ws_1",
        expected: {
          workspaceId: "ws_1",
          capsuleId: "cap_1",
          runId: "run_plan",
        },
      },
      {
        controlUrl: "https://operator.test",
        fetch: async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : input.toString(),
          );
          const method = init?.method ?? "GET";
          seen.push(`${method} ${url.pathname}`);
          if (method === "GET") {
            return json({
              run: {
                id: "run_plan",
                workspaceId: "ws_1",
                capsuleId: "cap_1",
                status: "waiting_approval",
              },
            });
          }
          throw new Error(`unexpected background mutation: ${url.pathname}`);
        },
      },
    );

    expect(result.status).toBe(409);
    expect(result.body?.error).toMatchObject({
      code: "failed_precondition",
    });
    expect(seen).toEqual(["GET /api/v1/runs/run_plan"]);
  });

  test("replays lost approval and apply acknowledgements for the same exact Run", async () => {
    const seen: string[] = [];
    let runStatus = "waiting_approval";
    let approveAttempts = 0;
    let applyAttempts = 0;
    const result = await approveAndApplyInstallableAppCapsule(
      {
        workspaceId: "ws_1",
        expected: {
          workspaceId: "ws_1",
          capsuleId: "cap_1",
          runId: "run_plan",
        },
      },
      {
        controlUrl: "https://operator.test",
        fetch: async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : input.toString(),
          );
          const method = init?.method ?? "GET";
          seen.push(`${method} ${url.pathname}`);
          if (method === "GET") {
            return json({
              run: {
                id: "run_plan",
                workspaceId: "ws_1",
                capsuleId: "cap_1",
                status: runStatus,
              },
            });
          }
          expect(JSON.parse(String(init?.body))).toEqual({});
          if (url.pathname.endsWith("/approve")) {
            approveAttempts += 1;
            runStatus = "succeeded";
            if (approveAttempts === 1) throw new Error("approval ACK lost");
            return json({
              run: {
                id: "run_plan",
                workspaceId: "ws_1",
                capsuleId: "cap_1",
                status: runStatus,
              },
            });
          }
          if (url.pathname.endsWith("/apply")) {
            applyAttempts += 1;
            if (applyAttempts === 1) throw new Error("apply ACK lost");
            return json({ run: { id: "run_apply", status: "queued" } }, 202);
          }
          return json({ error: "unexpected" }, 500);
        },
      },
    );

    expect(result.status).toBe(202);
    expect(seen).toEqual([
      "GET /api/v1/runs/run_plan",
      "POST /api/v1/runs/run_plan/approve",
      "POST /api/v1/runs/run_plan/approve",
      "GET /api/v1/runs/run_plan",
      "POST /api/v1/runs/run_plan/apply",
      "POST /api/v1/runs/run_plan/apply",
    ]);
  });

  test("interactive revision apply approves and re-fences its exact Capsule Run", async () => {
    const seen: string[] = [];
    let runStatus = "waiting_approval";
    const result = await approveAndApplyInstallableAppRevision(
      {
        workspaceId: "ws_1",
        capsuleId: "cap_1",
        operation: "upgrade",
        expected: {
          workspaceId: "ws_1",
          capsuleId: "cap_1",
          runId: "run_revision",
        },
      },
      {
        controlUrl: "https://operator.test",
        fetch: async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : input.toString(),
          );
          const method = init?.method ?? "GET";
          seen.push(`${method} ${url.pathname}`);
          if (method === "GET") {
            return json({
              run: {
                id: "run_revision",
                workspaceId: "ws_1",
                capsuleId: "cap_1",
                status: runStatus,
              },
            });
          }
          if (url.pathname.endsWith("/approve")) {
            runStatus = "succeeded";
            return json({
              run: {
                id: "run_revision",
                workspaceId: "ws_1",
                capsuleId: "cap_1",
                status: runStatus,
              },
            });
          }
          if (url.pathname.endsWith("/apply")) {
            return json({ run: { id: "run_revision_apply" } }, 202);
          }
          return json({ error: "unexpected" }, 500);
        },
      },
    );

    expect(result.status).toBe(202);
    expect(seen).toEqual([
      "GET /api/v1/runs/run_revision",
      "POST /api/v1/runs/run_revision/approve",
      "GET /api/v1/runs/run_revision",
      "POST /api/v1/runs/run_revision/apply",
    ]);
  });

  test("retries coordinator create with one idempotency key and never sends variables", async () => {
    const idempotencyKeys: string[] = [];
    let createAttempts = 0;
    const previousSleep = installableAppInstallDeps.sleep;
    installableAppInstallDeps.sleep = async () => undefined;
    try {
      const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const method = init?.method ?? "GET";
        if (
          method === "POST" &&
          url.pathname === "/api/v1/workspaces/ws_1/install-plans"
        ) {
          idempotencyKeys.push(
            new Headers(init?.headers).get("Idempotency-Key") ?? "",
          );
          createAttempts += 1;
          if (createAttempts === 1) throw new Error("ack lost");
          const body = JSON.parse(String(init?.body));
          expect(body).not.toHaveProperty("variables");
          return json(
            {
              installPlan: {
                id: "gip_retry",
                workspaceId: "ws_1",
                source: body.source,
                capsule: body.capsule,
                options: body.options,
                phase: "reviewable",
                sourceId: "src_retry",
                capsuleId: "cap_retry",
                planRunId: "run_retry",
              },
              nextAction: "review_run",
              links: { self: "/api/v1/install-plans/gip_retry" },
            },
            201,
          );
        }
        if (method === "GET" && url.pathname === "/api/v1/install-plans/gip_retry") {
          return json({
            installPlan: {
              id: "gip_retry",
              workspaceId: "ws_1",
              source: {
                name: "office-source",
                url: "https://github.com/acme/office.git",
                ref: "v1",
                path: ".",
              },
              capsule: { name: "office", environment: "production" },
              options: {},
              phase: "reviewable",
              sourceId: "src_retry",
              capsuleId: "cap_retry",
              planRunId: "run_retry",
            },
            nextAction: "review_run",
            links: { self: "/api/v1/install-plans/gip_retry" },
          });
        }
        if (method === "GET" && url.pathname === "/api/v1/runs/run_retry") {
          return json({
            run: {
              id: "run_retry",
              workspaceId: "ws_1",
              capsuleId: "cap_retry",
            },
          });
        }
        return json({ error: "unexpected" }, 500);
      };
      const result = await planInstallableAppCapsule(
        {
          workspaceId: "ws_1",
          appId: "office",
          gitUrl: "https://github.com/acme/office.git",
          ref: "v1",
          variables: {},
        },
        {
          controlUrl: "https://operator.test",
          idempotencyKey: "install-test-retry",
          fetch,
        },
      );
      expect(result.status).toBe(201);
      expect(idempotencyKeys).toHaveLength(2);
      expect(idempotencyKeys[0]).toBeTruthy();
      expect(idempotencyKeys[1]).toBe(idempotencyKeys[0]);
    } finally {
      installableAppInstallDeps.sleep = previousSleep;
    }
  });

  test("rejects legacy variable values before any coordinator request", async () => {
    let requests = 0;
    await expect(
      planInstallableAppCapsule(
        {
          workspaceId: "ws_1",
          appId: "office",
          gitUrl: "https://github.com/acme/office.git",
          ref: "v1",
          variables: { provider_token: "do-not-leak" },
        },
        {
          controlUrl: "https://operator.test",
          idempotencyKey: "install-test-vars",
          fetch: async () => {
            requests += 1;
            return json({ error: "must not fetch" }, 500);
          },
        },
      ),
    ).rejects.toThrow(
      "variables are not accepted by the canonical install-plan coordinator",
    );
    expect(requests).toBe(0);
  });

  test("returns coordinator conflicts and failures without inventing a Run", async () => {
    const previousSleep = installableAppInstallDeps.sleep;
    installableAppInstallDeps.sleep = async () => undefined;
    try {
      const conflict = await planInstallableAppCapsule(
        {
          workspaceId: "ws_1",
          appId: "office",
          gitUrl: "https://github.com/acme/office.git",
          ref: "v1",
        },
        {
          controlUrl: "https://operator.test",
          idempotencyKey: "install-test-conflict",
          fetch: async (input, init) => {
            const url = new URL(
              input instanceof Request ? input.url : input.toString(),
            );
            if (init?.method === "POST" && url.pathname.endsWith("install-plans")) {
              return json(
                {
                  installPlan: {
                    id: "gip_conflict",
                    workspaceId: "ws_1",
                    phase: "syncing_source",
                  },
                  nextAction: "reconcile",
                  links: { self: "/api/v1/install-plans/gip_conflict" },
                },
                201,
              );
            }
            if (init?.method === "GET") {
              return json({
                installPlan: {
                  id: "gip_conflict",
                  workspaceId: "ws_1",
                  phase: "syncing_source",
                },
                nextAction: "reconcile",
                links: { self: "/api/v1/install-plans/gip_conflict" },
              });
            }
            return json({ error: "reconcile_conflict" }, 409);
          },
        },
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body?.error).toBe("reconcile_conflict");

      const failed = await planInstallableAppCapsule(
        {
          workspaceId: "ws_1",
          appId: "office",
          gitUrl: "https://github.com/acme/office.git",
          ref: "v1",
        },
        {
          controlUrl: "https://operator.test",
          idempotencyKey: "install-test-failed",
          fetch: async (input, init) => {
            const url = new URL(
              input instanceof Request ? input.url : input.toString(),
            );
            if (init?.method === "POST") {
              return json(
                {
                  installPlan: {
                    id: "gip_failed",
                    workspaceId: "ws_1",
                    phase: "syncing_source",
                  },
                  nextAction: "reconcile",
                  links: { self: "/api/v1/install-plans/gip_failed" },
                },
                201,
              );
            }
            return json({
              installPlan: {
                id: "gip_failed",
                workspaceId: "ws_1",
                phase: "failed",
                diagnostic: {
                  code: "source_sync_failed",
                  message: "safe diagnostic",
                },
              },
              nextAction: "none",
              links: { self: `/api/v1/install-plans/${url.pathname.split("/").pop()}` },
            });
          },
        },
      );
      expect(failed.status).toBe(409);
      expect(failed.body?.error).toBe("install_plan_failed");
    } finally {
      installableAppInstallDeps.sleep = previousSleep;
    }
  });

  test("bounds reconcile polling and reports timeout without applying", async () => {
    const requests: string[] = [];
    const previousSleep = installableAppInstallDeps.sleep;
    installableAppInstallDeps.sleep = async () => undefined;
    try {
      const result = await planInstallableAppCapsule(
        {
          workspaceId: "ws_1",
          appId: "office",
          gitUrl: "https://github.com/acme/office.git",
          ref: "v1",
        },
        {
          controlUrl: "https://operator.test",
          idempotencyKey: "install-test-timeout",
          fetch: async (input, init) => {
            const url = new URL(
              input instanceof Request ? input.url : input.toString(),
            );
            requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
            if (init?.method === "POST" && url.pathname.endsWith("install-plans")) {
              return json(
                {
                  installPlan: {
                    id: "gip_timeout",
                    workspaceId: "ws_1",
                    phase: "syncing_source",
                  },
                  nextAction: "reconcile",
                  links: { self: "/api/v1/install-plans/gip_timeout" },
                },
                201,
              );
            }
            return json({
              installPlan: {
                id: "gip_timeout",
                workspaceId: "ws_1",
                phase: "syncing_source",
              },
              nextAction: "reconcile",
              links: {
                self: "/api/v1/install-plans/gip_timeout",
                reconcile: "/api/v1/install-plans/gip_timeout/reconcile",
              },
            });
          },
        },
      );
      expect(result.status).toBe(409);
      expect(result.body?.error).toBe("install_plan_timeout");
      expect(
        requests.filter((request) => request.includes("/reconcile")),
      ).toHaveLength(12);
      expect(requests.some((request) => request.includes("/runs/"))).toBe(false);
    } finally {
      installableAppInstallDeps.sleep = previousSleep;
    }
  });

  test("fences exact Workspace and Capsule Run references", async () => {
    const config = {
      controlUrl: "https://operator.test",
      fetch: async () => json({ error: "must not fetch" }, 500),
    };
    await expect(
      applyInstallableAppCapsule(
        {
          workspaceId: "ws_owner",
          expected: {
            workspaceId: "ws_other",
            capsuleId: "cap_1",
            runId: "run_1",
          },
        },
        config,
      ),
    ).rejects.toThrow("another Workspace");
    await expect(
      applyInstallableAppRevision(
        {
          workspaceId: "ws_owner",
          capsuleId: "cap_owner",
          operation: "upgrade",
          expected: {
            workspaceId: "ws_owner",
            capsuleId: "cap_other",
            runId: "run_1",
          },
        },
        config,
      ),
    ).rejects.toThrow("another Capsule");
  });

  test("uses the durable revision coordinator for upgrade and StateVersion rollback-plan for rollback", async () => {
    const seen: SeenRequest[] = [];
    const phases = ["syncing_source", "planning", "reviewable"] as const;
    let phaseIndex = 0;
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      seen.push({
        method,
        pathname: url.pathname,
        search: url.search,
        body,
        idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
      });
      if (url.pathname === "/api/v1/capsules/cap_1") {
        return json({
          capsule: { id: "cap_1", workspaceId: "ws_1", sourceId: "src_1" },
        });
      }
      if (
        url.pathname === "/api/v1/capsules/cap_1/revision-plans" &&
        method === "POST"
      ) {
        return json(
          {
            revisionPlan: {
              id: "grp_1",
              workspaceId: "ws_1",
              operation: "revision",
              capsuleId: "cap_1",
              sourceId: "src_1",
              installConfigId: "icfg_1",
              phase: phases[phaseIndex],
            },
            nextAction: "reconcile",
            links: {
              self: "/api/v1/revision-plans/grp_1",
              reconcile: "/api/v1/revision-plans/grp_1/reconcile",
            },
          },
          201,
        );
      }
      if (
        url.pathname === "/api/v1/revision-plans/grp_1" &&
        method === "GET"
      ) {
        const phase = phases[phaseIndex];
        return json({
          revisionPlan: {
            id: "grp_1",
            workspaceId: "ws_1",
            operation: "revision",
            capsuleId: "cap_1",
            sourceId: "src_1",
            installConfigId: "icfg_1",
            phase,
            ...(phase === "reviewable" ? { planRunId: "run_upgrade" } : {}),
          },
          nextAction: phase === "reviewable" ? "review_run" : "reconcile",
          links: {
            self: "/api/v1/revision-plans/grp_1",
            ...(phase === "reviewable"
              ? { run: "/api/v1/runs/run_upgrade" }
              : { reconcile: "/api/v1/revision-plans/grp_1/reconcile" }),
          },
        });
      }
      if (
        url.pathname === "/api/v1/revision-plans/grp_1/reconcile" &&
        method === "POST"
      ) {
        phaseIndex = Math.min(phaseIndex + 1, phases.length - 1);
        const phase = phases[phaseIndex];
        return json({
          revisionPlan: {
            id: "grp_1",
            workspaceId: "ws_1",
            operation: "revision",
            capsuleId: "cap_1",
            sourceId: "src_1",
            installConfigId: "icfg_1",
            phase,
            ...(phase === "reviewable" ? { planRunId: "run_upgrade" } : {}),
          },
          nextAction: phase === "reviewable" ? "review_run" : "reconcile",
          links: {
            self: "/api/v1/revision-plans/grp_1",
            ...(phase === "reviewable"
              ? { run: "/api/v1/runs/run_upgrade" }
              : { reconcile: "/api/v1/revision-plans/grp_1/reconcile" }),
          },
        });
      }
      if (url.pathname === "/api/v1/runs/run_upgrade" && method === "GET") {
        return json({
          run: {
            id: "run_upgrade",
            workspaceId: "ws_1",
            capsuleId: "cap_1",
            sourceId: "src_1",
            status: "waiting_approval",
          },
        });
      }
      if (url.pathname === "/api/v1/state-versions/sv%2Fold/rollback-plan") {
        return json({ run: { id: "run_rollback" } }, 201);
      }
      return json({ error: "unexpected" }, 500);
    };
    const config = { controlUrl: "https://operator.test", fetch };
    const upgrade = await planInstallableAppRevision(
      {
        workspaceId: "ws_1",
        capsuleId: "cap_1",
        operation: "upgrade",
        ref: "v2",
        idempotencyKey: "revision-http-1",
      },
      config,
    );
    const rollback = await planInstallableAppRevision(
      {
        workspaceId: "ws_1",
        capsuleId: "cap_1",
        operation: "rollback",
        ref: "sv/old",
      },
      config,
    );
    expect(upgrade.body?.expected).toMatchObject({ runId: "run_upgrade" });
    expect(upgrade.body?.capsule).toMatchObject({
      id: "cap_1",
      workspaceId: "ws_1",
      sourceId: "src_1",
    });
    expect(rollback.body?.expected).toMatchObject({ runId: "run_rollback" });
    expect(seen[0]).toMatchObject({
      method: "POST",
      pathname: "/api/v1/capsules/cap_1/revision-plans",
      body: { ref: "v2" },
      idempotencyKey: "revision-http-1",
    });
    expect(
      seen.some((request) =>
        request.pathname.startsWith("/api/v1/sources/"),
      ),
    ).toBe(false);
    expect(seen).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/api/v1/state-versions/sv%2Fold/rollback-plan",
      }),
    );
  });

  test("retries a lost revision create ACK with the same key and exact ref-only body", async () => {
    const previousSleep = installableAppInstallDeps.sleep;
    installableAppInstallDeps.sleep = async () => {};
    try {
      const seen: SeenRequest[] = [];
      let createAttempts = 0;
      const fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const method = init?.method ?? "GET";
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        seen.push({
          method,
          pathname: url.pathname,
          search: url.search,
          body,
          idempotencyKey: new Headers(init?.headers).get("Idempotency-Key"),
        });
        if (url.pathname === "/api/v1/capsules/cap_1" && method === "GET") {
          return json({ capsule: { id: "cap_1", workspaceId: "ws_1" } });
        }
        if (
          url.pathname === "/api/v1/capsules/cap_1/revision-plans" &&
          method === "POST"
        ) {
          createAttempts += 1;
          if (createAttempts === 1) throw new Error("lost ACK");
          return json({
            revisionPlan: {
              id: "grp_ack",
              workspaceId: "ws_1",
              operation: "revision",
              capsuleId: "cap_1",
              sourceId: "src_1",
              installConfigId: "icfg_1",
              planRunId: "run_upgrade",
              phase: "reviewable",
            },
            nextAction: "review_run",
            links: {
              self: "/api/v1/revision-plans/grp_ack",
              run: "/api/v1/runs/run_upgrade",
            },
          });
        }
        if (url.pathname === "/api/v1/revision-plans/grp_ack") {
          return json({
            revisionPlan: {
              id: "grp_ack",
              workspaceId: "ws_1",
              operation: "revision",
              capsuleId: "cap_1",
              sourceId: "src_1",
              installConfigId: "icfg_1",
              planRunId: "run_upgrade",
              phase: "reviewable",
            },
            nextAction: "review_run",
            links: {
              self: "/api/v1/revision-plans/grp_ack",
              run: "/api/v1/runs/run_upgrade",
            },
          });
        }
        if (url.pathname === "/api/v1/runs/run_upgrade") {
          return json({
            run: {
              id: "run_upgrade",
              workspaceId: "ws_1",
              capsuleId: "cap_1",
              sourceId: "src_1",
            },
          });
        }
        return json({ error: "unexpected" }, 500);
      };
      const result = await planInstallableAppRevision(
        {
          workspaceId: "ws_1",
          capsuleId: "cap_1",
          operation: "upgrade",
          ref: "release/v2",
          idempotencyKey: "revision-lost-ack-1",
        },
        { controlUrl: "https://operator.test", fetch },
      );
      expect(result.body?.expected).toMatchObject({
        workspaceId: "ws_1",
        sourceId: "src_1",
        capsuleId: "cap_1",
        runId: "run_upgrade",
      });
      expect(
        seen.filter(
          (request) =>
            request.method === "POST" &&
            request.pathname === "/api/v1/capsules/cap_1/revision-plans",
        ),
      ).toEqual([
        expect.objectContaining({
          body: { ref: "release/v2" },
          idempotencyKey: "revision-lost-ack-1",
        }),
        expect.objectContaining({
          body: { ref: "release/v2" },
          idempotencyKey: "revision-lost-ack-1",
        }),
      ]);
    } finally {
      installableAppInstallDeps.sleep = previousSleep;
    }
  });

  test("lists canonical Capsules verbatim and never treats Outputs as services", async () => {
    const fetch = async (input: string | URL | Request) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.pathname === "/api/v1/workspaces/ws_1/capsules") {
        return json({
          capsules: [
            {
              id: "cap_1",
              workspaceId: "ws_1",
              sourceId: "src_1",
              name: "office",
              status: "active",
            },
          ],
        });
      }
      if (url.pathname === "/api/v1/sources") {
        return json({
          sources: [{
            id: "src_1",
            workspaceId: "ws_1",
            url: "https://github.com/acme/office.git",
            defaultRef: "v1",
          }],
        });
      }
      if (url.pathname === "/api/v1/capsules/cap_1") {
        return json({ capsule: { id: "cap_1", workspaceId: "ws_1" } });
      }
      if (url.pathname.endsWith("/outputs"))
        throw new Error("Outputs must not be requested for runtime discovery");
      return json({ error: "unexpected" }, 500);
    };
    const config = { baseUrl: "https://operator.test", fetch };
    const listed = await listInstallableAppCapsules("ws_1", config);
    expect(listed.body?.capsules).toEqual([
      expect.objectContaining({ capsule_id: "cap_1", status: "active" }),
    ]);
    const services = await listInstallableAppCapsuleServices(
      "cap_1",
      "ws_1",
      config,
    );
    expect(services.body).toEqual({ capsule_id: "cap_1", services: [] });
  });

  test("projects a Workspace Capsule page with a constant number of authorized upstream reads", async () => {
    const seen: string[] = [];
    const timestamp = "2026-07-30T00:00:00.000Z";
    const launcher = (
      id: string,
      capsuleId: string,
      url: string,
      workspaceId = "ws_1",
    ) => ({
      apiVersion: TAKOSUMI_API_VERSION,
      kind: "Interface",
      metadata: {
        id,
        workspaceId,
        name: `${capsuleId}.launcher`,
        ownerRef: { kind: "Capsule", id: capsuleId },
        generation: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      spec: {
        type: UI_SURFACE_INTERFACE_TYPE,
        version: UI_SURFACE_INTERFACE_VERSION,
        document: { launcher: true, display: { title: capsuleId } },
        inputs: { url: { source: "literal", value: url } },
        access: { visibility: "workspace" },
      },
      status: {
        phase: "Resolved",
        observedGeneration: 1,
        resolvedRevision: 1,
        resolvedInputs: { url },
      },
    });
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      seen.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
      if (url.pathname === "/api/v1/workspaces/ws_1/capsules") {
        return json({
          capsules: [
            {
              id: "cap_1",
              workspaceId: "ws_1",
              sourceId: "src_1",
              name: "one",
              status: "active",
            },
            {
              id: "cap_2",
              workspaceId: "ws_1",
              sourceId: "src_2",
              name: "two",
              status: "active",
            },
          ],
        });
      }
      if (url.pathname === "/api/v1/sources") {
        return json({
          sources: [
            {
              id: "src_1",
              workspaceId: "ws_1",
              url: "https://github.com/acme/one.git",
              defaultRef: "v1",
            },
            {
              id: "src_2",
              workspaceId: "ws_1",
              url: "https://github.com/acme/two.git",
              defaultRef: "v2",
            },
          ],
        });
      }
      if (url.pathname === "/api/v1/workspaces/ws_1/ui-surfaces") {
        return json({
          interfaces: [
            launcher("if_1", "cap_1", "https://one.example.test"),
            launcher("if_2", "cap_2", "https://two.example.test"),
            launcher(
              "if_foreign",
              "cap_foreign",
              "https://foreign.example.test",
              "ws_foreign",
            ),
          ],
        });
      }
      throw new Error(`unexpected upstream read: ${url}`);
    };
    const result = await listInstallableAppCapsulesWithServices("ws_1", {
      baseUrl: "https://operator.test",
      token: "delegated-token",
      subjectId: "pairwise-user",
      fetch,
    });

    expect(result.status).toBe(200);
    expect(seen).toEqual([
      "GET /api/v1/workspaces/ws_1/capsules?includeDestroyed=false&limit=100",
      "GET /api/v1/sources?workspaceId=ws_1&limit=100",
      "GET /api/v1/workspaces/ws_1/ui-surfaces?limit=100",
    ]);
    expect(result.body?.capsules).toEqual([
      expect.objectContaining({
        capsule_id: "cap_1",
        source: expect.objectContaining({
          url: "https://github.com/acme/one.git",
        }),
        services: [
          expect.objectContaining({
            endpoint: "https://one.example.test/",
            status: "ready",
          }),
        ],
      }),
      expect.objectContaining({
        capsule_id: "cap_2",
        source: expect.objectContaining({
          url: "https://github.com/acme/two.git",
        }),
        services: [
          expect.objectContaining({
            endpoint: "https://two.example.test/",
            status: "ready",
          }),
        ],
      }),
    ]);
  });

  test("creates only a fenced destroy plan and never applies it", async () => {
    const seen: string[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const method = init?.method ?? "GET";
      seen.push(`${method} ${url.pathname}`);
      if (method === "GET")
        return json({ capsule: { id: "cap_1", workspaceId: "ws_1" } });
      if (method === "POST") {
        return json(
          {
            run: {
              id: "run_destroy",
              workspaceId: "ws_1",
              capsuleId: "cap_1",
              type: "destroy_plan",
              status: "waiting_approval",
            },
          },
          201,
        );
      }
      throw new Error(`unexpected mutation: ${method} ${url.pathname}`);
    };
    const result = await deleteInstallableAppCapsule("cap_1", "ws_1", {
      baseUrl: "https://operator.test",
      fetch,
    });
    expect(result.status).toBe(202);
    expect(result.body).toMatchObject({
      run: {
        id: "run_destroy",
        workspaceId: "ws_1",
        capsuleId: "cap_1",
      },
      expected: {
        workspaceId: "ws_1",
        capsuleId: "cap_1",
        runId: "run_destroy",
      },
    });
    expect(seen).toEqual([
      "GET /api/v1/capsules/cap_1",
      "POST /api/v1/capsules/cap_1/destroy-plan",
    ]);
  });

  test("rejects a destroy plan Run from another Workspace or Capsule", async () => {
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (init?.method === "POST") {
        return json(
          {
            run: {
              id: "run_foreign",
              workspaceId: "ws_other",
              capsuleId: "cap_other",
              type: "destroy_plan",
              status: "waiting_approval",
            },
          },
          201,
        );
      }
      if (url.pathname.endsWith("/capsules/cap_1")) {
        return json({ capsule: { id: "cap_1", workspaceId: "ws_1" } });
      }
      return json({ error: "unexpected" }, 500);
    };
    await expect(
      deleteInstallableAppCapsule("cap_1", "ws_1", {
        baseUrl: "https://operator.test",
        fetch,
      }),
    ).rejects.toThrow("another Workspace or Capsule");
  });
});
