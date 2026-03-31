// deno-lint-ignore-file no-explicit-any

import type { D1Database } from "@cloudflare/workers-types";
import {
  hashPassword,
  isValidRedirectUri,
  PASSWORD_PBKDF2_ITERATIONS,
  validateOAuthState,
  verifyPassword,
} from "../../../../../packages/control/src/application/services/identity/auth-utils.ts";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, spy } from "jsr:@std/testing/mock";

function createMockDb() {
  let firstImpl: (..._args: unknown[]) => Promise<unknown> = async () =>
    undefined;
  const bindMock = spy((..._args: unknown[]) => ({
    first: (..._firstArgs: unknown[]) => firstImpl(..._firstArgs),
  }));
  const prepareMock = spy((_sql: string) => ({
    bind: bindMock,
  }));

  return {
    db: {
      prepare: prepareMock,
    } as unknown as D1Database,
    prepareMock,
    bindMock,
    setFirstMock: (impl: (..._args: unknown[]) => Promise<unknown>) => {
      firstImpl = impl;
    },
  };
}

const validState = "a".repeat(64);
const futureIso = new Date(Date.now() + 60_000).toISOString();

Deno.test("validateOAuthState - fails closed without DB access for invalid state format", async () => {
  const { db, prepareMock } = createMockDb();

  const result = await validateOAuthState(db, "not-a-hex-state");

  assertEquals(result, { valid: false });
  assertSpyCalls(prepareMock, 0);
});
Deno.test("validateOAuthState - atomically consumes state with a single DELETE ... RETURNING query", async () => {
  const { db, prepareMock, bindMock, setFirstMock } = createMockDb();
  setFirstMock(async () => ({
    redirect_uri: "https://admin.takos.test/auth/callback",
    return_to: "cli_state_1234567",
    cli_callback: "http://localhost:3344/callback",
    expires_at: futureIso,
  }));

  const result = await validateOAuthState(db, validState);

  assertEquals(result, {
    valid: true,
    redirectUri: "https://admin.takos.test/auth/callback",
    returnTo: "cli_state_1234567",
    cliCallback: "http://localhost:3344/callback",
  });
  assertSpyCalls(prepareMock, 1);
  const sql = String(prepareMock.calls.at(0)?.args[0] ?? "");
  assertStringIncludes(sql, "DELETE FROM oauth_states");
  assertStringIncludes(
    sql,
    "RETURNING redirect_uri, return_to, cli_callback, expires_at",
  );
  assertSpyCallArgs(bindMock, 0, [validState]);
});
Deno.test("validateOAuthState - returns invalid when no state is consumed", async () => {
  const { db, prepareMock, setFirstMock } = createMockDb();
  setFirstMock(async () => null);

  const result = await validateOAuthState(db, validState);

  assertEquals(result, { valid: false });
  assertSpyCalls(prepareMock, 1);
});
Deno.test("validateOAuthState - normalizes nullable return fields to undefined", async () => {
  const { db, setFirstMock } = createMockDb();
  setFirstMock(async () => ({
    redirect_uri: "https://admin.takos.test/auth/callback",
    return_to: null,
    cli_callback: null,
    expires_at: futureIso,
  }));

  const result = await validateOAuthState(db, validState);

  assertEquals(result, {
    valid: true,
    redirectUri: "https://admin.takos.test/auth/callback",
    returnTo: undefined,
    cliCallback: undefined,
  });
});
Deno.test("validateOAuthState - fails closed after consuming an expired matched state", async () => {
  const { db, setFirstMock } = createMockDb();
  setFirstMock(async () => ({
    redirect_uri: "https://admin.takos.test/auth/callback",
    return_to: null,
    cli_callback: null,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  }));

  const result = await validateOAuthState(db, validState);

  assertEquals(result, { valid: false });
});
Deno.test("validateOAuthState - fails closed when consumed state has invalid expires_at", async () => {
  const { db, setFirstMock } = createMockDb();
  setFirstMock(async () => ({
    redirect_uri: "https://admin.takos.test/auth/callback",
    return_to: null,
    cli_callback: null,
    expires_at: "not-a-date",
  }));

  const result = await validateOAuthState(db, validState);

  assertEquals(result, { valid: false });
});
Deno.test("validateOAuthState - denies replay after first successful consume", async () => {
  const { db, prepareMock, setFirstMock } = createMockDb();
  let consumed = false;
  setFirstMock(async () => {
    if (consumed) {
      return null;
    }
    consumed = true;
    return {
      redirect_uri: "https://admin.takos.test/auth/callback",
      return_to: null,
      cli_callback: null,
      expires_at: futureIso,
    };
  });

  const first = await validateOAuthState(db, validState);
  const second = await validateOAuthState(db, validState);

  assertEquals(first.valid, true);
  assertEquals(second, { valid: false });
  assertSpyCalls(prepareMock, 2);
});

Deno.test("isValidRedirectUri - fails closed to localhost-only defaults when no env config is provided", () => {
  assertEquals(isValidRedirectUri("https://takos.jp/callback"), false);
  assertEquals(isValidRedirectUri("http://localhost:3000/callback"), true);
});
Deno.test("isValidRedirectUri - accepts admin-domain fallback when caller provides it explicitly", () => {
  assertEquals(
    isValidRedirectUri(
      "https://admin.takos.test/oauth/callback",
      undefined,
      ["admin.takos.test", "localhost", "127.0.0.1"],
    ),
    true,
  );
});
Deno.test("isValidRedirectUri - accepts configured allowlist domains and subdomains over HTTPS", () => {
  assertEquals(
    isValidRedirectUri(
      "https://client.example.com/oauth/callback",
      "example.com,service.example.net",
      ["admin.takos.test"],
    ),
    true,
  );
  assertEquals(
    isValidRedirectUri(
      "https://service.example.net/oauth/callback",
      "example.com,service.example.net",
      ["admin.takos.test"],
    ),
    true,
  );
});
Deno.test("isValidRedirectUri - rejects non-HTTPS redirect on non-localhost domain even when configured", () => {
  assertEquals(
    isValidRedirectUri(
      "http://client.example.com/oauth/callback",
      "example.com",
      ["admin.takos.test"],
    ),
    false,
  );
});

Deno.test("password hashing - uses a Cloudflare-compatible PBKDF2 iteration count and verifies round-trip", async () => {
  assertEquals(PASSWORD_PBKDF2_ITERATIONS, 100000);

  const hash = await hashPassword("correct horse battery staple");

  assert(/^[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash));
  await assertEquals(
    await verifyPassword("correct horse battery staple", hash),
    true,
  );
  await assertEquals(await verifyPassword("wrong password", hash), false);
});
