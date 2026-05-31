import { test } from "bun:test";
import { Hono } from "hono";
import { assertEquals, assertStringIncludes } from "@std/assert";

import type { Env, User } from "../../../../shared/types/index.ts";
import privacy, { privacyRouteDeps } from "../privacy.ts";
import type { BaseVariables } from "../../route-auth.ts";

const testUser: User = {
  id: "user-1",
  email: "user@example.com",
  name: "Test User",
  username: "test-user",
  principal_kind: "user",
  bio: null,
  picture: null,
  trust_tier: "normal",
  setup_completed: true,
  created_at: "2026-05-07T00:00:00.000Z",
  updated_at: "2026-05-07T00:00:00.000Z",
};

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: BaseVariables }>();
  app.use("*", async (c, next) => {
    c.set("user", testUser);
    await next();
  });
  app.route("/privacy", privacy);
  return app;
}

const originalDeps = { ...privacyRouteDeps };

function restoreDeps() {
  Object.assign(privacyRouteDeps, originalDeps);
}

test("privacy access endpoint returns data subject rights summary", async () => {
  privacyRouteDeps.getPrivacyAccessSummary = async () => ({
    version: "2026-05-07",
    subject: {
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      display_name: testUser.name,
    },
    request_status: { status: "none" },
    available_actions: [
      { type: "access", method: "GET", path: "/api/me/privacy/access" },
      { type: "export", method: "GET", path: "/api/me/privacy/export" },
      {
        type: "deletion",
        method: "POST",
        path: "/api/me/privacy/deletion-requests",
      },
    ],
    lawful_basis_url: "/legal/privacy-rights#lawful-bases",
    privacy_policy_url: "/privacy",
  });

  try {
    const response = await createApp().request("/privacy/access", {}, {
      DB: {},
    } as unknown as Env);
    const body = await response.json() as {
      subject: { id: string };
      available_actions: Array<{ type: string }>;
    };

    assertEquals(response.status, 200);
    assertEquals(body.subject.id, testUser.id);
    assertEquals(
      body.available_actions.map((action: { type: string }) => action.type),
      [
        "access",
        "export",
        "deletion",
      ],
    );
  } finally {
    restoreDeps();
  }
});

test("privacy export endpoint returns attachment JSON without token secrets", async () => {
  privacyRouteDeps.buildDataSubjectExport = async () => ({
    version: "2026-05-07",
    subject: {
      id: testUser.id,
      email: testUser.email,
      username: testUser.username,
      display_name: testUser.name,
    },
    request_status: { status: "none" },
    available_actions: [],
    lawful_basis_url: "/legal/privacy-rights#lawful-bases",
    privacy_policy_url: "/privacy",
    exported_at: "2026-05-07T00:00:00.000Z",
    account: { id: testUser.id },
    settings: [],
    metadata: [],
    memberships: [],
    auth: {
      identities: [],
      sessions: [],
    },
    app_usage: { events: [], rollups: [] },
    repositories: [],
    threads: [],
    messages: [],
    runs: [],
    memories: [],
    notifications: [],
  });

  try {
    const response = await createApp().request("/privacy/export", {}, {
      DB: {},
    } as unknown as Env);
    const body = await response.json() as { auth: { sessions: unknown[] } };

    assertEquals(response.status, 200);
    assertStringIncludes(
      response.headers.get("content-disposition") ?? "",
      `takos-data-export-${testUser.id}-`,
    );
    assertEquals(Array.isArray(body.auth.sessions), true);
  } finally {
    restoreDeps();
  }
});

test("privacy deletion request revokes current session and clears cookie", async () => {
  const calls: string[] = [];
  privacyRouteDeps.requestAccountDeletion = async () => {
    calls.push("request");
    return {
      request_id: "dsr_1",
      status: "pending",
      requested_at: "2026-05-07T00:00:00.000Z",
      account_status: "pending_deletion",
      revoked: {
        auth_sessions: 3,
      },
    };
  };
  privacyRouteDeps.getSessionIdFromCookie = () => "session_1234567890";
  privacyRouteDeps.recordSessionRevocation = async () => {
    calls.push("revocation");
  };
  privacyRouteDeps.deleteSession = async () => {
    calls.push("delete-session");
  };
  privacyRouteDeps.getPlatformServices = () =>
    ({ notifications: { sessionStore: {} } }) as ReturnType<
      typeof privacyRouteDeps.getPlatformServices
    >;
  privacyRouteDeps.clearSessionCookie = () =>
    "__Host-tp_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0";

  try {
    const response = await createApp().request("/privacy/deletion-requests", {
      method: "POST",
      headers: { Cookie: "__Host-tp_session=session_1234567890" },
      body: JSON.stringify({ reason: "close account" }),
    }, { DB: {} } as unknown as Env);
    const body = await response.json() as { account_status: string };

    assertEquals(response.status, 202);
    assertEquals(body.account_status, "pending_deletion");
    assertEquals(calls, ["request", "revocation", "delete-session"]);
    assertStringIncludes(
      response.headers.get("set-cookie") ?? "",
      "__Host-tp_session=;",
    );
  } finally {
    restoreDeps();
  }
});
