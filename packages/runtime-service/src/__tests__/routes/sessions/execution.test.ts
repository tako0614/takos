import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createTestApp, testRequest } from "../../setup.ts";

async function loadRuntimeApp() {
  const { default: sessionsRoutes } = await import(
    "../../../routes/sessions/session-routes.ts"
  );
  const { default: sessionExecutionRoutes } = await import(
    "../../../routes/sessions/execution.ts"
  );
  const { sessionStore } = await import("../../../routes/sessions/storage.ts");
  return { sessionStore, sessionsRoutes, sessionExecutionRoutes };
}

Deno.test({
  name:
    "session exec route drops implicit GitHub Actions env prefixes without explicit allowlist",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
    const originalAllowlist = Deno.env.get("TAKOS_ACTIONS_ENV_ALLOWLIST");
    Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
    Deno.env.delete("TAKOS_ACTIONS_ENV_ALLOWLIST");

    try {
      const { sessionStore, sessionsRoutes, sessionExecutionRoutes } =
        await loadRuntimeApp();
      const sessionId = "a12345678901234j";
      const spaceId = "ws-alpha";
      const subject = "takos-runtime-test";
      const app = createTestApp();
      app.use("*", async (c: any, next) => {
        c.set("serviceToken", { sub: subject });
        c.set("serviceAuthMethod", "jwt");
        await next();
      });
      app.route("/", sessionsRoutes);
      app.route("/", sessionExecutionRoutes);
      await sessionStore.getSessionDir(sessionId, spaceId, subject);

      try {
        const response = await testRequest(app as never, {
          method: "POST",
          path: "/session/exec",
          body: {
            session_id: sessionId,
            space_id: spaceId,
            commands: ["env"],
            env: {
              GITHUB_REF: "refs/heads/main",
              INPUT_NAME: "debug",
              RUNNER_TEMP: "/tmp/runner-temp",
              GIT_TERMINAL_PROMPT: "0",
            },
          },
        });

        assertEquals(response.status, 200);
        const output = (response.body as { output?: string }).output ?? "";
        assertStringIncludes(output, "GIT_TERMINAL_PROMPT=0");
        assertStringIncludes(output, "RUNNER_TEMP=/tmp/runner-temp");
        assertEquals(
          output.includes("GITHUB_REF=refs/heads/main"),
          false,
        );
        assertEquals(
          output.includes("INPUT_NAME=debug"),
          false,
        );
      } finally {
        await sessionStore.destroySession(sessionId, spaceId, subject);
      }
    } finally {
      if (originalTakosApiUrl === undefined) {
        Deno.env.delete("TAKOS_API_URL");
      } else {
        Deno.env.set("TAKOS_API_URL", originalTakosApiUrl);
      }
      if (originalAllowlist === undefined) {
        Deno.env.delete("TAKOS_ACTIONS_ENV_ALLOWLIST");
      } else {
        Deno.env.set("TAKOS_ACTIONS_ENV_ALLOWLIST", originalAllowlist);
      }
    }
  },
});

Deno.test({
  name: "session exec route honors explicit GitHub Actions allowlist entries",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");
    const originalAllowlist = Deno.env.get("TAKOS_ACTIONS_ENV_ALLOWLIST");
    Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
    Deno.env.set(
      "TAKOS_ACTIONS_ENV_ALLOWLIST",
      "GITHUB_* INPUT_MODE RUNNER_*",
    );

    try {
      const { sessionStore, sessionsRoutes, sessionExecutionRoutes } =
        await loadRuntimeApp();
      const sessionId = "a12345678901234k";
      const spaceId = "ws-beta";
      const subject = "takos-runtime-test";
      const app = createTestApp();
      app.use("*", async (c: any, next) => {
        c.set("serviceToken", { sub: subject });
        c.set("serviceAuthMethod", "jwt");
        await next();
      });
      app.route("/", sessionsRoutes);
      app.route("/", sessionExecutionRoutes);
      await sessionStore.getSessionDir(sessionId, spaceId, subject);

      try {
        const response = await testRequest(app as never, {
          method: "POST",
          path: "/session/exec",
          body: {
            session_id: sessionId,
            space_id: spaceId,
            commands: ["env"],
            env: {
              GITHUB_REF: "refs/heads/main",
              INPUT_MODE: "debug",
              RUNNER_WORKSPACE: "/tmp/runner-workspace",
            },
          },
        });

        assertEquals(response.status, 200);
        const output = (response.body as { output?: string }).output ?? "";
        assertStringIncludes(output, "GITHUB_REF=refs/heads/main");
        assertStringIncludes(output, "INPUT_MODE=debug");
        assertStringIncludes(output, "RUNNER_WORKSPACE=/tmp/runner-workspace");
      } finally {
        await sessionStore.destroySession(sessionId, spaceId, subject);
      }
    } finally {
      if (originalTakosApiUrl === undefined) {
        Deno.env.delete("TAKOS_API_URL");
      } else {
        Deno.env.set("TAKOS_API_URL", originalTakosApiUrl);
      }
      if (originalAllowlist === undefined) {
        Deno.env.delete("TAKOS_ACTIONS_ENV_ALLOWLIST");
      } else {
        Deno.env.set("TAKOS_ACTIONS_ENV_ALLOWLIST", originalAllowlist);
      }
    }
  },
});
