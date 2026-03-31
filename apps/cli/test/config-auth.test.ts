import { assertEquals, assertThrows } from "@std/assert";
import { assertSpyCallArgs, stub } from "@std/testing/mock";
import { withCliTestEnv } from "./test-support.ts";

type ConfigAuthModule = typeof import("../src/lib/config-auth.ts");
type CliLogModule = typeof import("../src/lib/cli-log.ts");

const VALID_SESSION_ID = "550e8400-e29b-41d4-a716-446655440000";

Deno.test("DEFAULT_API_URL - is https://takos.jp", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { DEFAULT_API_URL } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );
    assertEquals(DEFAULT_API_URL, "https://takos.jp");
  });
});

Deno.test("logWarning - writes to stderr with prefix", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { logWarning } = await importFresh<CliLogModule>(
      "../src/lib/cli-log.ts",
    );
    const errorSpy = stub(console, "error", () => {});

    try {
      logWarning("test message");
      assertSpyCallArgs(errorSpy, 0, ["[takos-cli warning] test message"]);
    } finally {
      errorSpy.restore();
    }
  });
});

Deno.test("isContainerMode - detects environment and session-file auth", async () => {
  await withCliTestEnv(async ({ importFresh, writeSessionFile }) => {
    const { isContainerMode } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    assertEquals(isContainerMode(), false);

    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    assertEquals(isContainerMode(), true);

    Deno.env.delete("TAKOS_SESSION_ID");
    Deno.env.set("TAKOS_TOKEN", "api-token");
    assertEquals(isContainerMode(), true);

    Deno.env.delete("TAKOS_TOKEN");
    writeSessionFile({
      session_id: VALID_SESSION_ID,
      workspace_id: "ws-test",
    });
    assertEquals(isContainerMode(), true);
  });
});

Deno.test("getConfig - uses TAKOS_SESSION_ID and env overrides", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { getConfig, DEFAULT_API_URL } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_WORKSPACE_ID", "my-workspace");
    Deno.env.set("TAKOS_API_URL", "https://api.takos.dev");

    assertEquals(getConfig(), {
      apiUrl: "https://api.takos.dev",
      sessionId: VALID_SESSION_ID,
      workspaceId: "my-workspace",
      spaceId: "my-workspace",
    });

    Deno.env.delete("TAKOS_API_URL");
    assertEquals(getConfig().apiUrl, DEFAULT_API_URL);
  });
});

Deno.test("getConfig - uses TAKOS_TOKEN when no session id is set", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { getConfig, DEFAULT_API_URL } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    Deno.env.set("TAKOS_TOKEN", "my-api-token");
    Deno.env.set("TAKOS_WORKSPACE_ID", "workspace-token");

    assertEquals(getConfig(), {
      apiUrl: DEFAULT_API_URL,
      token: "my-api-token",
      workspaceId: "workspace-token",
      spaceId: "workspace-token",
    });
  });
});

Deno.test("getConfig - prefers TAKOS_SESSION_ID over TAKOS_TOKEN", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { getConfig } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_TOKEN", "my-token");

    const config = getConfig();
    assertEquals(config.sessionId, VALID_SESSION_ID);
    assertEquals(config.token, undefined);
  });
});

Deno.test("getConfig - validates session id, workspace id, and api url env vars", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { getConfig } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    Deno.env.set("TAKOS_SESSION_ID", "invalid!@#");
    assertThrows(() => getConfig(), Error, "Invalid TAKOS_SESSION_ID format");

    Deno.env.set("TAKOS_SESSION_ID", VALID_SESSION_ID);
    Deno.env.set("TAKOS_WORKSPACE_ID", "invalid workspace!@#$");
    assertThrows(() => getConfig(), Error, "Invalid TAKOS_WORKSPACE_ID format");

    Deno.env.set("TAKOS_WORKSPACE_ID", "workspace-ok");
    Deno.env.set("TAKOS_API_URL", "https://evil.example.com");
    assertThrows(() => getConfig(), Error, "Invalid TAKOS_API_URL");
  });
});

Deno.test("getConfig - reads session file and defaults api url when omitted", async () => {
  await withCliTestEnv(async ({ importFresh, writeSessionFile }) => {
    const { getConfig, DEFAULT_API_URL } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    writeSessionFile({
      session_id: VALID_SESSION_ID,
      workspace_id: "ws-file",
    });

    assertEquals(getConfig(), {
      apiUrl: DEFAULT_API_URL,
      sessionId: VALID_SESSION_ID,
      workspaceId: "ws-file",
      spaceId: "ws-file",
    });
  });
});

Deno.test("getConfig - respects api_url from the session file", async () => {
  await withCliTestEnv(async ({ importFresh, writeSessionFile }) => {
    const { getConfig } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    writeSessionFile({
      session_id: VALID_SESSION_ID,
      workspace_id: "ws-test",
      api_url: "https://api.takos.dev",
    });

    assertEquals(getConfig().apiUrl, "https://api.takos.dev");
  });
});

Deno.test("getConfig - reads external config from the temp home directory", async () => {
  await withCliTestEnv(async ({ importFresh, writeConfig }) => {
    const { getConfig } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    writeConfig({
      token: "stored-token",
      apiUrl: "https://takos.io",
    });

    assertEquals(getConfig(), {
      apiUrl: "https://takos.io",
      token: "stored-token",
    });
  });
});

Deno.test("getConfig - falls back to the default api url for invalid config values", async () => {
  await withCliTestEnv(async ({ importFresh, writeConfig }) => {
    const { getConfig, DEFAULT_API_URL } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    writeConfig({
      token: "stored-token",
      apiUrl: "https://evil.example.com",
    });

    assertEquals(getConfig(), {
      apiUrl: DEFAULT_API_URL,
      token: "stored-token",
    });
  });
});

Deno.test("isAuthenticated - reflects resolved auth state", async () => {
  await withCliTestEnv(async ({ importFresh, writeSessionFile }) => {
    const { isAuthenticated } = await importFresh<ConfigAuthModule>(
      "../src/lib/config-auth.ts",
    );

    assertEquals(isAuthenticated(), false);

    Deno.env.set("TAKOS_TOKEN", "some-token");
    assertEquals(isAuthenticated(), true);

    Deno.env.delete("TAKOS_TOKEN");
    writeSessionFile({
      session_id: VALID_SESSION_ID,
      workspace_id: "ws-test",
    });
    assertEquals(isAuthenticated(), true);
  });
});
