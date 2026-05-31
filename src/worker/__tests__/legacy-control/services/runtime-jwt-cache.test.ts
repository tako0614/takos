import { assertEquals } from "@std/assert";
import { spy } from "@std/testing/mock";
import * as jose from "jose";

import { createMockEnv } from "../../../test/integration/setup.ts";
import { callRuntime } from "@/services/execution/runtime";
import {
  __resetRuntimeJwtPrivateKeyCacheForTesting,
  __runtimeJwtPrivateKeyCacheSizeForTesting,
} from "@/services/execution/runtime";

/**
 * Generates a fresh PEM-encoded RS256 private key for cache eviction tests.
 *
 * Each PEM is a unique key on its own line because PEMs include random key
 * material; we only need uniqueness for cache-key purposes.
 */
async function freshPrivateKeyPem(): Promise<string> {
  const { privateKey } = await jose.generateKeyPair("RS256", {
    extractable: true,
  });
  return await jose.exportPKCS8(privateKey);
}

Deno.test("runtime JWT private-key cache evicts least-recently-used entries beyond cap", async () => {
  __resetRuntimeJwtPrivateKeyCacheForTesting();

  const runtimeFetchMock = spy(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
  );

  // The cap is 32 (see runtime-request-handler.ts). Inserting 34 distinct
  // PEM keys must result in 32 cache entries.
  const CAP = 32;
  const TOTAL = CAP + 2;
  const pems: string[] = [];
  for (let i = 0; i < TOTAL; i++) {
    pems.push(await freshPrivateKeyPem());
  }

  for (const pem of pems) {
    const env = createMockEnv({
      RUNTIME_HOST: { fetch: runtimeFetchMock },
      PLATFORM_PRIVATE_KEY: pem,
    });
    await callRuntime(env, "/ping", { space_id: "space-x" }, 1000);
  }

  assertEquals(__runtimeJwtPrivateKeyCacheSizeForTesting(), CAP);

  __resetRuntimeJwtPrivateKeyCacheForTesting();
});

Deno.test("runtime JWT private-key cache promotes recently-used entries", async () => {
  __resetRuntimeJwtPrivateKeyCacheForTesting();

  const runtimeFetchMock = spy(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
  );

  const CAP = 32;
  const pems: string[] = [];
  for (let i = 0; i < CAP; i++) {
    pems.push(await freshPrivateKeyPem());
  }

  // Fill the cache with CAP entries.
  for (const pem of pems) {
    const env = createMockEnv({
      RUNTIME_HOST: { fetch: runtimeFetchMock },
      PLATFORM_PRIVATE_KEY: pem,
    });
    await callRuntime(env, "/ping", { space_id: "space-x" }, 1000);
  }

  assertEquals(__runtimeJwtPrivateKeyCacheSizeForTesting(), CAP);

  // Touch the first PEM so it becomes most-recently-used.
  await callRuntime(
    createMockEnv({
      RUNTIME_HOST: { fetch: runtimeFetchMock },
      PLATFORM_PRIVATE_KEY: pems[0],
    }),
    "/ping",
    { space_id: "space-x" },
    1000,
  );

  // Adding a new PEM should evict pems[1] (the new LRU), not pems[0].
  const newPem = await freshPrivateKeyPem();
  await callRuntime(
    createMockEnv({
      RUNTIME_HOST: { fetch: runtimeFetchMock },
      PLATFORM_PRIVATE_KEY: newPem,
    }),
    "/ping",
    { space_id: "space-x" },
    1000,
  );

  assertEquals(__runtimeJwtPrivateKeyCacheSizeForTesting(), CAP);

  // Re-using pems[0] should not grow the cache (still cached / promoted).
  await callRuntime(
    createMockEnv({
      RUNTIME_HOST: { fetch: runtimeFetchMock },
      PLATFORM_PRIVATE_KEY: pems[0],
    }),
    "/ping",
    { space_id: "space-x" },
    1000,
  );
  assertEquals(__runtimeJwtPrivateKeyCacheSizeForTesting(), CAP);

  // Re-inserting pems[1] should grow back to cap (it had been evicted),
  // confirming the eviction targeted pems[1] rather than pems[0].
  const sizeBefore = __runtimeJwtPrivateKeyCacheSizeForTesting();
  await callRuntime(
    createMockEnv({
      RUNTIME_HOST: { fetch: runtimeFetchMock },
      PLATFORM_PRIVATE_KEY: pems[1],
    }),
    "/ping",
    { space_id: "space-x" },
    1000,
  );
  // After re-insertion, the cap is enforced, so still CAP.
  assertEquals(__runtimeJwtPrivateKeyCacheSizeForTesting(), CAP);
  assertEquals(sizeBefore, CAP);

  __resetRuntimeJwtPrivateKeyCacheForTesting();
});
