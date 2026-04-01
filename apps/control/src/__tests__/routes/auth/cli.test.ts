import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "jsr:@std/assert";

import type { Env } from "@/types";
import { authCliRouter } from "@/routes/auth/cli";
import { createMockEnv } from "../../../../test/integration/setup.ts";

const VALID_OAUTH_STATE = "a".repeat(64);
const CLI_RETURN_TO = "cli_state_1234567890";

function createOAuthStateDb() {
  return {
    prepare(_sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            first: async () => ({
              redirect_uri: "https://admin.takos.test/auth/cli/callback",
              return_to: CLI_RETURN_TO,
              cli_callback: "http://localhost:3344/callback",
              expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            }),
          };
        },
      };
    },
  };
}

function createEnv(overrides: Partial<Record<string, unknown>> = {}): Env {
  return createMockEnv({
    ADMIN_DOMAIN: "admin.takos.test",
    DB: createOAuthStateDb(),
    ...overrides,
  }) as unknown as Env;
}

async function callCliCallback(
  url: string,
  env: Env = createEnv(),
): Promise<Response> {
  return authCliRouter.fetch(new Request(url), env, {} as ExecutionContext);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function sha256Base64(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return toBase64(new Uint8Array(digest));
}

Deno.test("auth cli callback transport - sets CSP and response transport headers", async () => {
  const response = await callCliCallback(
    `http://localhost/cli/callback?state=${VALID_OAUTH_STATE}&error=access_denied`,
  );

  assertEquals(response.status, 200);

  const csp = response.headers.get("content-security-policy");
  assert(csp !== null);

  assertStringIncludes(csp, "default-src 'none'");
  assertStringIncludes(csp, "base-uri 'none'");
  assertStringIncludes(csp, "frame-ancestors 'none'");
  assertStringIncludes(
    csp,
    "form-action 'self' http://127.0.0.1:* http://localhost:*",
  );
  assert(/script-src 'sha256-[A-Za-z0-9+/=]+'/.test(csp));
  assert(/style-src 'sha256-[A-Za-z0-9+/=]+'/.test(csp));
  assert(!csp.includes("'unsafe-inline'"));

  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
});

Deno.test("auth cli callback transport - renders callback transport HTML with form, style, and script", async () => {
  const response = await callCliCallback(
    `http://localhost/cli/callback?state=${VALID_OAUTH_STATE}&error=access_denied`,
  );

  assertEquals(response.status, 200);
  const html = await response.text();

  assertStringIncludes(
    html,
    '<form id="cli-callback-form" method="POST" action="http://localhost:3344/callback">',
  );
  assertStringIncludes(
    html,
    '<input type="hidden" name="error" value="access_denied" />',
  );
  assertStringIncludes(
    html,
    `<input type="hidden" name="state" value="${CLI_RETURN_TO}" />`,
  );
  assertStringIncludes(html, "<noscript>");
  assertStringIncludes(html, "<style>");
  assertStringIncludes(
    html,
    "body{font-family:system-ui,sans-serif;padding:24px;}",
  );
  assertStringIncludes(html, "<script>");
  assertStringIncludes(
    html,
    "document.getElementById('cli-callback-form')?.submit();",
  );
  assert(!html.includes("<body style="));
});

Deno.test("auth cli callback transport - matches CSP sha256 hashes to rendered inline assets", async () => {
  const response = await callCliCallback(
    `http://localhost/cli/callback?state=${VALID_OAUTH_STATE}&error=access_denied`,
  );

  assertEquals(response.status, 200);

  const csp = response.headers.get("content-security-policy");
  assert(csp !== null);

  const html = await response.text();
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);

  assertNotEquals(scriptMatch, null);
  assertNotEquals(styleMatch, null);
  if (!scriptMatch || !styleMatch) {
    throw new Error("Expected inline script and style tags");
  }

  const scriptHash = await sha256Base64(scriptMatch[1]);
  const styleHash = await sha256Base64(styleMatch[1]);

  assertStringIncludes(csp, `script-src 'sha256-${scriptHash}'`);
  assertStringIncludes(csp, `style-src 'sha256-${styleHash}'`);
});
