import { describe, expect, test } from "bun:test";

import {
  approveInstallableAppPlanRun,
  applyInstallableAppCapsule,
  applyInstallableAppRevision,
  deleteInstallableAppCapsule,
  getInstallableAppPlanRun,
  listInstallableAppCapsuleServices,
  listInstallableAppCapsules,
  listInstallableAppCapsulesWithServices,
  planInstallableAppCapsule,
  planInstallableAppRevision,
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
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("canonical Capsule install client", () => {
  test("runs Source sync -> Capsule plan -> exact Run apply", async () => {
    const seen: SeenRequest[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      seen.push({ method, pathname: url.pathname, search: url.search, body });
      if (method === "GET" && url.pathname === "/control/api/v1/sources") {
        return json({ sources: [] });
      }
      if (method === "POST" && url.pathname === "/control/api/v1/sources") {
        return json(
          {
            source: {
              id: "src_1",
              workspaceId: "ws_1",
              name: "office-source",
              url: "https://github.com/acme/office.git",
              defaultRef: "v1.0.0",
              defaultPath: ".",
            },
          },
          201,
        );
      }
      if (url.pathname === "/control/api/v1/sources/src_1/sync") {
        return json({ run: { id: "run_sync", status: "succeeded" } }, 201);
      }
      if (
        method === "GET" &&
        url.pathname.endsWith("/workspaces/ws_1/capsules")
      ) {
        return json({ capsules: [] });
      }
      if (
        method === "POST" &&
        url.pathname.endsWith("/workspaces/ws_1/capsules")
      ) {
        return json(
          {
            capsule: {
              id: "cap_1",
              workspaceId: "ws_1",
              sourceId: "src_1",
              name: "office",
              environment: "production",
            },
          },
          201,
        );
      }
      if (url.pathname === "/control/api/v1/capsules/cap_1/plan") {
        return json({ run: { id: "run_plan" } }, 201);
      }
      if (url.pathname === "/control/api/v1/runs/run_plan/apply") {
        return json({ run: { id: "run_apply", status: "queued" } }, 202);
      }
      return json({ error: "unexpected" }, 500);
    };
    const config = { controlUrl: "https://operator.test/control", fetch };
    const source = {
      workspaceId: "ws_1",
      appId: "office",
      gitUrl: "https://github.com/acme/office.git",
      ref: "v1.0.0",
    };
    const plan = await planInstallableAppCapsule(source, config);
    expect(plan.status).toBe(201);
    expect(plan.body?.expected).toEqual({
      workspaceId: "ws_1",
      sourceId: "src_1",
      capsuleId: "cap_1",
      runId: "run_plan",
    });
    const applied = await applyInstallableAppCapsule(
      {
        workspaceId: source.workspaceId,
        expected: plan.body!.expected as Record<string, unknown>,
      },
      config,
    );
    expect(applied.status).toBe(202);
    expect(seen.map(({ method, pathname }) => `${method} ${pathname}`)).toEqual(
      [
        "GET /control/api/v1/sources",
        "POST /control/api/v1/sources",
        "POST /control/api/v1/sources/src_1/sync",
        "GET /control/api/v1/workspaces/ws_1/capsules",
        "POST /control/api/v1/workspaces/ws_1/capsules",
        "POST /control/api/v1/capsules/cap_1/plan",
        "POST /control/api/v1/runs/run_plan/apply",
      ],
    );
    expect(seen[0]?.search).toBe("?workspaceId=ws_1");
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

  test("reads and approves only a Workspace-fenced canonical plan Run", async () => {
    const seen: string[] = [];
    const config = {
      controlUrl: "https://operator.test/control",
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(
          input instanceof Request ? input.url : input.toString(),
        );
        const method = init?.method ?? "GET";
        seen.push(`${method} ${url.pathname}`);
        return json({
          run: {
            id: "run_plan",
            workspaceId: "ws_owner",
            capsuleId: "cap_1",
            type: "plan",
            status: method === "POST" ? "succeeded" : "waiting_approval",
          },
        });
      },
    };
    const input = { workspaceId: "ws_owner", runId: "run_plan" };
    expect((await getInstallableAppPlanRun(input, config)).body?.run)
      .toMatchObject({ status: "waiting_approval" });
    expect((await approveInstallableAppPlanRun(input, config)).body?.run)
      .toMatchObject({ status: "succeeded" });
    expect(seen).toEqual([
      "GET /control/api/v1/runs/run_plan",
      "POST /control/api/v1/runs/run_plan/approve",
    ]);
  });

  test("rejects plan Run readback from another Workspace or identity", async () => {
    const input = { workspaceId: "ws_owner", runId: "run_plan" };
    for (const run of [
      {
        id: "run_plan",
        workspaceId: "ws_other",
        type: "plan",
        status: "succeeded",
      },
      {
        id: "run_other",
        workspaceId: "ws_owner",
        type: "plan",
        status: "succeeded",
      },
      {
        id: "run_plan",
        workspaceId: "ws_owner",
        type: "apply",
        status: "succeeded",
      },
    ]) {
      await expect(
        getInstallableAppPlanRun(input, {
          controlUrl: "https://operator.test",
          fetch: async () => json({ run }),
        }),
      ).rejects.toThrow();
    }
  });

  test("uses Source sync for upgrade and StateVersion rollback-plan for rollback", async () => {
    const seen: string[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const method = init?.method ?? "GET";
      seen.push(`${method} ${url.pathname}`);
      if (url.pathname === "/api/v1/capsules/cap_1") {
        return json({
          capsule: { id: "cap_1", workspaceId: "ws_1", sourceId: "src_1" },
        });
      }
      if (url.pathname === "/api/v1/sources/src_1" && method === "GET") {
        return json({
          source: {
            id: "src_1",
            workspaceId: "ws_1",
            url: "https://github.com/acme/app.git",
          },
        });
      }
      if (url.pathname === "/api/v1/sources/src_1" && method === "PATCH") {
        return json({ source: { id: "src_1" } });
      }
      if (url.pathname === "/api/v1/sources/src_1/sync") {
        return json({ run: { id: "run_sync", status: "succeeded" } }, 201);
      }
      if (url.pathname === "/api/v1/capsules/cap_1/plan") {
        return json({ run: { id: "run_upgrade" } }, 201);
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
        gitUrl: "https://github.com/acme/app.git",
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
    expect(rollback.body?.expected).toMatchObject({ runId: "run_rollback" });
    expect(seen).toContain("POST /api/v1/sources/src_1/sync");
    expect(seen).toContain(
      "POST /api/v1/state-versions/sv%2Fold/rollback-plan",
    );
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

  test("deletes only a Capsule in the requested Workspace and applies its returned destroy Run", async () => {
    const seen: string[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      const method = init?.method ?? "GET";
      seen.push(`${method} ${url.pathname}`);
      if (method === "GET")
        return json({ capsule: { id: "cap_1", workspaceId: "ws_1" } });
      if (method === "DELETE") return json({ run: { id: "run_destroy" } }, 202);
      return json({ run: { id: "run_destroy_apply" } }, 202);
    };
    const result = await deleteInstallableAppCapsule("cap_1", "ws_1", {
      baseUrl: "https://operator.test",
      fetch,
    });
    expect(result.status).toBe(202);
    expect(seen).toEqual([
      "GET /api/v1/capsules/cap_1",
      "DELETE /api/v1/capsules/cap_1",
      "POST /api/v1/runs/run_destroy/apply",
    ]);
  });
});
