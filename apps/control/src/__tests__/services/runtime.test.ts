import type { Env } from "@/types";
import { callRuntime } from "@/services/execution/runtime";
import * as jose from "jose";

import { assertEquals, assertRejects } from "jsr:@std/assert";
import { assertSpyCalls, spy } from "jsr:@std/testing/mock";

Deno.test("callRuntime - throws when RUNTIME_HOST binding is missing", async () => {
  try {
    await assertRejects(async () => {
      await callRuntime({} as Env, "/exec", {}, 1000);
    }, "RUNTIME_HOST binding is required");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("callRuntime - sets X-Takos-Internal-Marker without JWT when PLATFORM_PRIVATE_KEY is absent", async () => {
  try {
    const runtimeFetchMock = spy(async () =>
      new Response(null, { status: 200 })
    );

    const env = {
      RUNTIME_HOST: { fetch: runtimeFetchMock },
    } as unknown as Env;

    await callRuntime(env, "/exec", { foo: "bar" }, 1000);

    assertSpyCalls(runtimeFetchMock, 1);
    const request = (runtimeFetchMock.calls[0] as unknown as {
      args: [RequestInfo | URL, RequestInit?];
    }).args[0] as Request;
    assertEquals(request.method, "POST");
    assertEquals(request.url, "https://runtime-host/exec");
    assertEquals(request.headers.get("X-Takos-Internal-Marker"), "1");
    assertEquals(request.headers.get("X-Takos-Internal"), null);
    assertEquals(request.headers.get("Authorization"), null);
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
Deno.test("callRuntime - signs runtime-service JWT with PLATFORM_PRIVATE_KEY", async () => {
  const runtimeFetchMock = spy(async () => new Response(null, { status: 200 }));
  const { privateKey, publicKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  const privateKeyPem = await jose.exportPKCS8(privateKey);

  const env = {
    RUNTIME_HOST: { fetch: runtimeFetchMock },
    PLATFORM_PRIVATE_KEY: privateKeyPem,
  } as unknown as Env;

  await callRuntime(
    env,
    "/session/init",
    {
      space_id: "space-123",
      session_id: "session-123",
      user_id: "user-123",
    },
    1000,
  );

  assertSpyCalls(runtimeFetchMock, 1);
  const request = (runtimeFetchMock.calls[0] as unknown as {
    args: [RequestInfo | URL, RequestInit?];
  }).args[0] as Request;
  const token = request.headers.get("Authorization")?.replace(
    /^Bearer\s+/,
    "",
  );
  if (!token) throw new Error("Expected runtime-service JWT");

  const { payload, protectedHeader } = await jose.jwtVerify(token, publicKey, {
    issuer: "takos-control",
    audience: "takos-runtime",
  });

  assertEquals(protectedHeader.alg, "RS256");
  assertEquals(payload.sub, "user-123");
  assertEquals(payload.scope_space_id, "space-123");
  assertEquals(payload.session_id, "session-123");
});
Deno.test("callRuntime - does not use JWT_PRIVATE_KEY as a signing fallback", async () => {
  const runtimeFetchMock = spy(async () => new Response(null, { status: 200 }));
  const { privateKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  const privateKeyPem = await jose.exportPKCS8(privateKey);

  const env = {
    RUNTIME_HOST: { fetch: runtimeFetchMock },
    JWT_PRIVATE_KEY: privateKeyPem,
  } as unknown as Env;

  await callRuntime(env, "/session/init", { space_id: "space-123" }, 1000);

  const request = (runtimeFetchMock.calls[0] as unknown as {
    args: [RequestInfo | URL, RequestInit?];
  }).args[0] as Request;
  assertEquals(request.headers.get("Authorization"), null);
});
Deno.test("callRuntime - passes space_id as X-Takos-Space-Id header", async () => {
  try {
    const runtimeFetchMock = spy(async () =>
      new Response(null, { status: 200 })
    );

    const env = {
      RUNTIME_HOST: { fetch: runtimeFetchMock },
    } as unknown as Env;

    await callRuntime(
      env,
      "/session/init",
      { space_id: "space-123", foo: "bar" },
      1000,
    );

    assertSpyCalls(runtimeFetchMock, 1);
    const request = (runtimeFetchMock.calls[0] as unknown as {
      args: [RequestInfo | URL, RequestInit?];
    }).args[0] as Request;
    assertEquals(request.headers.get("X-Takos-Space-Id"), "space-123");
  } finally {
    /* TODO: restore stubbed globals manually */ void 0;
  }
});
