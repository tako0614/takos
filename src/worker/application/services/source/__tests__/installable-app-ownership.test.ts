import { describe, expect, test } from "bun:test";
import {
  applyInstallableAppCapsule,
  deleteInstallableAppCapsule,
  listInstallableAppCapsules,
  planInstallableAppCapsule,
} from "../installable-app-install.ts";

describe("per-app Accounts control client", () => {
  test("creates and applies a workspace-less attempt while fencing plan, capsule and run", async () => {
    const seen: { path: string; method: string; body: unknown; key: string | null }[] = [];
    const installPlan = {
      id: "plan-a", capsuleId: "cap-a", sourceId: "source-a", planRunId: "run-a",
      capsule: { name: "app-a" }, source: { url: "https://example.test/app.git" },
    };
    const run = { id: "run-a", capsuleId: "cap-a", sourceId: "source-a", status: "succeeded" };
    const config = {
      controlUrl: "https://accounts.test",
      token: "caller-token",
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        const method = init?.method ?? "GET";
        seen.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : null,
          key: new Headers(init?.headers).get("Idempotency-Key") });
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer caller-token");
        if (path === "/api/v1/install-plans") {
          return Response.json({ installPlan, nextAction: "review_run" }, { status: 201 });
        }
        if (path === "/api/v1/install-plans/plan-a") {
          return Response.json({ installPlan, nextAction: "review_run" });
        }
        if (path === "/api/v1/runs/run-a") return Response.json({ run });
        if (path === "/api/v1/runs/run-a/apply") return Response.json({ accepted: true });
        throw new Error(`unexpected request ${path}`);
      },
    };
    const planned = await planInstallableAppCapsule({
      gitUrl: "https://example.test/app.git", ref: "main", idempotencyKey: "app-attempt-a",
    }, config);
    expect(planned.status).toBe(201);
    expect(seen[0]).toMatchObject({
      path: "/api/v1/install-plans", method: "POST", key: "app-attempt-a",
      body: { mode: "attempt" },
    });
    expect(planned.body?.expected).toEqual({ sourceId: "source-a", capsuleId: "cap-a", runId: "run-a" });
    expect((await applyInstallableAppCapsule({
      expected: planned.body!.expected as Record<string, unknown>,
    }, config)).status).toBe(200);
    run.capsuleId = "cap-other";
    const mutations = seen.filter((request) => request.path.endsWith("/apply")).length;
    await expect(applyInstallableAppCapsule({
      expected: planned.body!.expected as Record<string, unknown>,
    }, config)).rejects.toThrow("another Capsule");
    expect(seen.filter((request) => request.path.endsWith("/apply")).length).toBe(mutations);
    expect(seen.some((request) => request.path.includes("/workspaces/"))).toBe(false);
  });

  test("uses the value-free apps response without requiring legacy source/workspace rows", async () => {
    const result = await listInstallableAppCapsules(undefined, {
      baseUrl: "https://accounts.test",
      fetch: async (input) => {
        expect(new URL(input instanceof Request ? input.url : input).pathname).toBe("/api/v1/apps");
        return Response.json({
          apps: [{ capsuleId: "cap-a", name: "app-a", role: "member", ownerDisplayName: "Owner",
            state: "active", primaryAction: "open" }], nextCursor: "next-a",
        });
      },
    });
    expect(result.body).toMatchObject({
      capsules: [{ capsule_id: "cap-a", role: "member", owner_display_name: "Owner" }],
      nextCursor: "next-a",
    });
  });

  test("does not fall back or mutate after an app access denial", async () => {
    const paths: string[] = [];
    const result = await planInstallableAppCapsule({
      gitUrl: "https://example.test/app.git", ref: "main", idempotencyKey: "denied-attempt",
    }, {
      controlUrl: "https://accounts.test",
      fetch: async (input) => {
        paths.push(new URL(input instanceof Request ? input.url : input).pathname);
        return Response.json({ error: { code: "app_access_denied" } }, { status: 403 });
      },
    });
    expect(result.status).toBe(403);
    expect(paths).toEqual(["/api/v1/install-plans"]);
  });

  test("rejects another capsule's workspace-less destroy run", async () => {
    await expect(deleteInstallableAppCapsule("cap-a", undefined, {
      baseUrl: "https://accounts.test",
      fetch: async (input) => {
        const path = new URL(input instanceof Request ? input.url : input).pathname;
        return Response.json(path.endsWith("/destroy-plan")
          ? { run: { id: "run-a", capsuleId: "cap-other" } }
          : { capsule: { id: "cap-a" } });
      },
    })).rejects.toThrow("another Workspace or Capsule");
  });
});
