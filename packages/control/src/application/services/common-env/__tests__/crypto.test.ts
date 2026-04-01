import {
  createBindingFingerprint,
  decryptCommonEnvValue,
  encryptCommonEnvValue,
  fingerprintMatches,
  getCommonEnvSecret,
  isManagedCommonEnvKey,
  isReservedSpaceCommonEnvKey,
  MANAGED_COMMON_ENV_KEYS,
  type normalizeCommonEnvName,
  normalizeEnvName,
  RESERVED_SPACE_COMMON_ENV_KEYS,
  uniqueEnvNames,
} from "../crypto.ts";

import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert";

const env = {
  ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
} as const;

Deno.test("normalizeEnvName uppercases and trims valid names", () => {
  assertEquals(normalizeEnvName("  my_var  "), "MY_VAR");
});

Deno.test("normalizeEnvName rejects invalid names", () => {
  assertThrows(() => normalizeEnvName(""), Error, "required");
  assertThrows(() => normalizeEnvName("1_VAR"), Error, "Invalid");
});

Deno.test("uniqueEnvNames deduplicates normalized names", () => {
  assertEquals(uniqueEnvNames(["foo", "FOO", "bar"]), ["FOO", "BAR"]);
});

Deno.test("managed env key helpers expose the expected sets", () => {
  assert(isManagedCommonEnvKey("APP_BASE_URL"));
  assert(isReservedSpaceCommonEnvKey("TAKOS_API_URL"));
  assertEquals(MANAGED_COMMON_ENV_KEYS.has("TAKOS_ACCESS_TOKEN"), true);
  assertEquals(RESERVED_SPACE_COMMON_ENV_KEYS.has("APP_BASE_URL"), false);
});

Deno.test("getCommonEnvSecret requires ENCRYPTION_KEY", () => {
  assertThrows(
    () => getCommonEnvSecret({ ENCRYPTION_KEY: "" } as never),
    Error,
    "must be set",
  );
});

Deno.test("encrypt/decrypt common env values round-trip", async () => {
  const encrypted = await encryptCommonEnvValue(
    env,
    "space-1",
    "MY_SECRET",
    "super-secret",
  );
  const decrypted = await decryptCommonEnvValue(env, {
    space_id: "space-1",
    name: "MY_SECRET",
    value_encrypted: encrypted,
  });

  assertEquals(decrypted, "super-secret");
});

Deno.test("decryptCommonEnvValue rejects invalid payloads", async () => {
  await assertRejects(
    () =>
      decryptCommonEnvValue(env, {
        space_id: "space-1",
        name: "MY_SECRET",
        value_encrypted: "not-json",
      }),
    Error,
    "Failed to parse encrypted value",
  );
});

Deno.test("fingerprint helpers produce stable v2 fingerprints", async () => {
  const first = await createBindingFingerprint({
    env,
    spaceId: "space-1",
    envName: "my_var",
    type: "plain_text",
    text: "hello",
  });
  const second = await createBindingFingerprint({
    env,
    spaceId: "space-1",
    envName: "my_var",
    type: "plain_text",
    text: "world",
  });

  assert(first?.startsWith("v2:"));
  assertNotEquals(first, second);
  assertEquals(
    await fingerprintMatches({
      env,
      stored: first,
      spaceId: "space-1",
      envName: "my_var",
      type: "plain_text",
      text: "hello",
    }),
    true,
  );
});
