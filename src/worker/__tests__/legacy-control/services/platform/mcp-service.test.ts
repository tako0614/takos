import { assertEquals, assertThrows } from "@std/assert";

import {
  assertAllowedMcpEndpointUrl,
  getMcpEndpointUrlOptions,
} from "../../../../application/services/platform/mcp.ts";
import type { Env } from "@/shared/types/env.ts";

Deno.test("getMcpEndpointUrlOptions - returns strict options for production", () => {
  const options = getMcpEndpointUrlOptions(
    { ENVIRONMENT: "production" } as Pick<Env, "ENVIRONMENT">,
  );
  assertEquals(options, {
    allowHttp: false,
    allowLocalhost: false,
    allowPrivateIp: false,
  });
});

Deno.test("getMcpEndpointUrlOptions - returns permissive options for development", () => {
  const options = getMcpEndpointUrlOptions(
    { ENVIRONMENT: "development" } as Pick<Env, "ENVIRONMENT">,
  );
  assertEquals(options, {
    allowHttp: true,
    allowLocalhost: true,
    allowPrivateIp: true,
  });
});

Deno.test("assertAllowedMcpEndpointUrl - accepts HTTPS URLs in strict mode", () => {
  const url = assertAllowedMcpEndpointUrl(
    "https://api.example.com/mcp",
    { allowHttp: false, allowLocalhost: false, allowPrivateIp: false },
    "test",
  );
  assertEquals(url.hostname, "api.example.com");
  assertEquals(url.protocol, "https:");
});

Deno.test("assertAllowedMcpEndpointUrl - rejects invalid URLs", () => {
  assertThrows(
    () =>
      assertAllowedMcpEndpointUrl(
        "not-a-url",
        { allowHttp: false, allowLocalhost: false, allowPrivateIp: false },
        "test",
      ),
    Error,
    "test URL is invalid",
  );
});

Deno.test("assertAllowedMcpEndpointUrl - rejects HTTP when not allowed", () => {
  assertThrows(
    () =>
      assertAllowedMcpEndpointUrl(
        "http://api.example.com",
        { allowHttp: false, allowLocalhost: false, allowPrivateIp: false },
        "test",
      ),
    Error,
    "test URL must use HTTPS",
  );
});

Deno.test("assertAllowedMcpEndpointUrl - allows localhost over HTTP in development", () => {
  const url = assertAllowedMcpEndpointUrl(
    "http://localhost:8080",
    { allowHttp: true, allowLocalhost: true, allowPrivateIp: true },
    "test",
  );
  assertEquals(url.hostname, "localhost");
  assertEquals(url.protocol, "http:");
});

Deno.test("assertAllowedMcpEndpointUrl - rejects URLs with credentials", () => {
  assertThrows(
    () =>
      assertAllowedMcpEndpointUrl(
        "https://user:pass@api.example.com",
        { allowHttp: false, allowLocalhost: false, allowPrivateIp: false },
        "test",
      ),
    Error,
    "must not include credentials",
  );
});
