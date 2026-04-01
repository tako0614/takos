// [Deno] vi.mock removed - manually stub imports from 'takos-common/validation'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/validate-env'
// [Deno] vi.mock removed - manually stub imports from '@/shared/utils/logger'
import egressModule from "@/worker/egress";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";

const handler = egressModule;

function createRequest(
  url: string,
  headers: Record<string, string> = {},
  method = "GET",
): Request {
  return new Request(url, {
    method,
    headers: {
      "X-Takos-Internal": "1",
      ...headers,
    },
  });
}

function createEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...overrides,
  };
}

Deno.test("egress handler - rejects requests without X-Takos-Internal header", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = new Request("https://example.com", {
    method: "GET",
    headers: {},
  });

  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 401);
  const body = await response.json() as { error: string };
  assertEquals(body.error, "Unauthorized");
});
Deno.test("egress handler - rejects non-HTTP/HTTPS protocols", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest("ftp://example.com/file.txt");
  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 400);
  const body = await response.json() as { error: string };
  assertStringIncludes(body.error, "Only HTTP/HTTPS URLs");
});
Deno.test("egress handler - rejects URLs with credentials", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest("https://user:pass@example.com/path");
  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 400);
  const body = await response.json() as { error: string };
  assertStringIncludes(body.error, "credentials");
});
Deno.test("egress handler - rejects non-standard ports", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest("https://example.com:8443/path");
  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 400);
  const body = await response.json() as { error: string };
  assertStringIncludes(body.error, "Port");
});
Deno.test("egress handler - rejects single-label hostnames", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest("https://localhost/path");
  // localhost is also a blocked hostname, but FQDN check comes first if it has no dot
  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 400);
  const body = await response.json() as { error: string };
  assert(body.error !== undefined);
});
Deno.test("egress handler - rejects blocked hostnames", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest("https://metadata.google.internal:443/path");
  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 403);
  const body = await response.json() as { error: string };
  assertStringIncludes(body.error, "internal/private");
});
Deno.test("egress handler - rejects .local domains", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = createRequest("https://myhost.local:443/path");
  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 403);
  const body = await response.json() as { error: string };
  assertStringIncludes(body.error, "internal/private");
});
Deno.test("egress handler - rejects requests with body too large", async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const request = new Request("https://example.com", {
    method: "POST",
    headers: {
      "X-Takos-Internal": "1",
    },
    body: "small",
  });
  request.headers.set("Content-Length", String(10 * 1024 * 1024 + 1));

  const response = await handler.fetch(request, createEnv() as any);
  assertEquals(response.status, 413);
});
