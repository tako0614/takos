import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { CONTROL_FORWARDERS } from "../control-forwarders.ts";

function forwarder(name: string) {
  const found = CONTROL_FORWARDERS.find((entry) => entry.name === name);
  if (!found) throw new Error(`no forwarder named ${name}`);
  return found;
}

test("registry exposes the seven control forwarders in dispatch order", () => {
  assertEquals(
    CONTROL_FORWARDERS.map((entry) => entry.name),
    ["account", "app-installations", "profile", "setup", "runs", "tools", "threads"],
  );
});

test("account forwarder matches /api/auth and /api/me but not /auth or removed PAT paths", () => {
  const account = forwarder("account");
  assertEquals(account.matches("/api/auth/session"), true);
  assertEquals(account.matches("/api/me"), true);
  assertEquals(account.matches("/auth/oidc/login"), true);
  // The interactive /auth/* surface (other than the upstream login/callback/logout)
  // is not control-forwarded.
  assertEquals(account.matches("/auth/oidc/consent"), false);
  // Personal-access-token paths were removed from the upstream surface.
  assertEquals(account.matches("/api/me/personal-access-tokens"), false);
  assertEquals(account.matches("/api/me/personal-access-tokens/abc"), false);
});

test("app-installations forwarder only matches /api/spaces/:id/app-installations", () => {
  const apps = forwarder("app-installations");
  assertEquals(apps.matches("/api/spaces/s1/app-installations"), true);
  assertEquals(apps.matches("/api/spaces/s1/app-installations/i1"), true);
  assertEquals(apps.matches("/api/spaces/s1/threads"), false);
});

test("profile forwarder matches the /api/users prefix", () => {
  const profile = forwarder("profile");
  assertEquals(profile.matches("/api/users"), true);
  assertEquals(profile.matches("/api/users/alice"), true);
  assertEquals(profile.matches("/api/usersX"), false);
});

test("setup forwarder matches the /api/setup prefix", () => {
  const setup = forwarder("setup");
  assertEquals(setup.matches("/api/setup"), true);
  assertEquals(setup.matches("/api/setup/admin"), true);
  assertEquals(setup.matches("/api/setupX"), false);
});

test("runs forwarder yields the apps-api-owned run reads to the apps surface", () => {
  const runs = forwarder("runs");
  // Collection + control-owned sub-resources stay on the control plane.
  assertEquals(runs.matches("/api/runs", "GET"), true);
  assertEquals(runs.matches("/api/runs/r1/logs", "GET"), true);
  // GET /api/runs/:id and its events/replay/sse/ws are apps-api-owned.
  assertEquals(runs.matches("/api/runs/r1", "GET"), false);
  assertEquals(runs.matches("/api/runs/r1/events", "GET"), false);
  // POST /api/runs/:id/cancel is apps-api-owned.
  assertEquals(runs.matches("/api/runs/r1/cancel", "POST"), false);
});

test("space-tools forwarder uses the 'tools' 404 label and yields GET reads", () => {
  const tools = forwarder("tools");
  // Mutations on /api/spaces/:id/tools are control-forwarded.
  assertEquals(tools.matches("/api/spaces/s1/tools", "POST"), true);
  // GET reads (4 or 5 segment) are apps-api-owned.
  assertEquals(tools.matches("/api/spaces/s1/tools", "GET"), false);
  assertEquals(tools.matches("/api/spaces/s1/tools/t1", "GET"), false);
});

test("threads forwarder yields read traffic to the apps surface", () => {
  const threads = forwarder("threads");
  assertEquals(threads.matches("/api/threads", "GET"), true);
  // GET /api/threads/:id is apps-api-owned.
  assertEquals(threads.matches("/api/threads/t1", "GET"), false);
  // POST /api/threads/:id/messages is apps-api-owned.
  assertEquals(threads.matches("/api/threads/t1/messages", "POST"), false);
});

test("a non-matching request to a forwarder returns the named NOT_FOUND envelope", async () => {
  const tools = forwarder("tools");
  const response = await tools.forward(
    new Request("http://internal/api/spaces/s1/tools", { method: "GET" }),
  );
  assertEquals(response.status, 404);
  const body = (await response.json()) as {
    error: { code: string; message: string };
  };
  assertEquals(body.error.code, "NOT_FOUND");
  // The label is "tools route not found", preserving the pre-refactor envelope.
  assertEquals(body.error.message, "tools route not found");
});
