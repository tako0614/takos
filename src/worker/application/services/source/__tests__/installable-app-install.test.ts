import { describe, expect, test } from "bun:test";

import {
  applyInstallableAppInstallation,
  applyInstallableAppRevision,
  deleteInstallableAppInstallation,
  listInstallableAppInstallationServices,
  listInstallableAppInstallations,
  planInstallableAppInstallation,
  planInstallableAppRevision,
} from "../installable-app-install.ts";

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
    const plan = await planInstallableAppInstallation(source, config);
    expect(plan.status).toBe(201);
    expect(plan.body?.expected).toEqual({
      workspaceId: "ws_1",
      sourceId: "src_1",
      capsuleId: "cap_1",
      runId: "run_plan",
    });
    const applied = await applyInstallableAppInstallation(
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
      applyInstallableAppInstallation(
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

  test("lists canonical Capsules and projects Interface authority separately from Output evidence", async () => {
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
      if (url.pathname === "/api/v1/sources/src_1") {
        return json({
          source: {
            id: "src_1",
            url: "https://github.com/acme/office.git",
            defaultRef: "v1",
          },
        });
      }
      if (url.pathname === "/api/v1/capsules/cap_1") {
        return json({ capsule: { id: "cap_1", workspaceId: "ws_1" } });
      }
      if (url.pathname === "/api/v1/capsules/cap_1/outputs") {
        return json({
          output: { publicOutputs: { launch_url: "https://ignored.test" } },
        });
      }
      if (url.pathname === "/v1/interfaces") {
        return json({
          interfaces: [
            {
              metadata: { id: "if_1", name: "ui" },
              spec: {
                type: "interface.ui.surface",
                access: { resourceUriInput: "url" },
              },
              status: {
                phase: "Resolved",
                resolvedInputs: { url: "https://office.test" },
              },
            },
          ],
        });
      }
      return json({ error: "unexpected" }, 500);
    };
    const config = { baseUrl: "https://operator.test", fetch };
    const listed = await listInstallableAppInstallations("ws_1", config);
    expect(listed.body?.installations).toEqual([
      expect.objectContaining({ id: "cap_1", status: "ready" }),
    ]);
    const services = await listInstallableAppInstallationServices(
      "cap_1",
      "ws_1",
      config,
    );
    expect(services.body?.services).toEqual([
      expect.objectContaining({
        id: "interface:ui",
        endpoint: "https://office.test",
      }),
      expect.objectContaining({ id: "output:launch_url", endpoint: null }),
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
    const result = await deleteInstallableAppInstallation("cap_1", "ws_1", {
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
