import {
  decrypt,
  decryptEnvVars,
  encrypt,
  type EncryptedData,
  encryptEnvVars,
  maskEnvVars,
} from "@/utils/crypto";

import { assertEquals, assertNotEquals, assertRejects } from "jsr:@std/assert";

const MASTER_SECRET = "a".repeat(64); // 64-char hex string
const SALT = "test-salt";

Deno.test("encrypt / decrypt - round-trips a simple string", async () => {
  const plaintext = "hello world";
  const encrypted = await encrypt(plaintext, MASTER_SECRET, SALT);
  const decrypted = await decrypt(encrypted, MASTER_SECRET, SALT);
  assertEquals(decrypted, plaintext);
});
Deno.test("encrypt / decrypt - round-trips an empty string", async () => {
  const encrypted = await encrypt("", MASTER_SECRET, SALT);
  const decrypted = await decrypt(encrypted, MASTER_SECRET, SALT);
  assertEquals(decrypted, "");
});
Deno.test("encrypt / decrypt - round-trips unicode content", async () => {
  const plaintext = "こんにちは世界 🌏";
  const encrypted = await encrypt(plaintext, MASTER_SECRET, SALT);
  const decrypted = await decrypt(encrypted, MASTER_SECRET, SALT);
  assertEquals(decrypted, plaintext);
});
Deno.test("encrypt / decrypt - produces different ciphertexts for the same plaintext (random IV)", async () => {
  const plaintext = "deterministic?";
  const e1 = await encrypt(plaintext, MASTER_SECRET, SALT);
  const e2 = await encrypt(plaintext, MASTER_SECRET, SALT);
  // IVs should differ, making ciphertexts differ
  assertNotEquals(e1.iv, e2.iv);
});
Deno.test("encrypt / decrypt - encrypted data has expected shape", async () => {
  const encrypted = await encrypt("test", MASTER_SECRET, SALT);
  assertEquals(encrypted.alg, "AES-256-GCM");
  assertEquals(encrypted.v, 1);
  assertEquals(typeof encrypted.ciphertext, "string");
  assertEquals(typeof encrypted.iv, "string");
});
Deno.test("encrypt / decrypt - rejects unsupported algorithm", async () => {
  const bad: EncryptedData = {
    ciphertext: "aaa",
    iv: "bbb",
    alg: "AES-256-GCM",
    v: 1,
  };
  // Tamper alg
  (bad as any).alg = "AES-128-CBC";
  await assertRejects(async () => {
    await decrypt(bad, MASTER_SECRET, SALT);
  }, "Unsupported encryption format");
});
Deno.test("encrypt / decrypt - rejects unsupported version", async () => {
  const bad: EncryptedData = {
    ciphertext: "aaa",
    iv: "bbb",
    alg: "AES-256-GCM",
    v: 1,
  };
  (bad as any).v = 2;
  await assertRejects(async () => {
    await decrypt(bad, MASTER_SECRET, SALT);
  }, "Unsupported encryption format");
});
Deno.test("encrypt / decrypt - fails to decrypt with wrong secret", async () => {
  const encrypted = await encrypt("secret data", MASTER_SECRET, SALT);
  const wrongSecret = "b".repeat(64);
  await assertRejects(async () => {
    await decrypt(encrypted, wrongSecret, SALT);
  });
});
Deno.test("encrypt / decrypt - fails to decrypt with wrong salt", async () => {
  const encrypted = await encrypt("secret data", MASTER_SECRET, SALT);
  await assertRejects(async () => {
    await decrypt(encrypted, MASTER_SECRET, "wrong-salt");
  });
});
Deno.test("encrypt / decrypt - handles 0x-prefixed hex secret", async () => {
  const hexSecret = "0x" + "ab".repeat(32);
  const encrypted = await encrypt("test", hexSecret, SALT);
  const decrypted = await decrypt(encrypted, hexSecret, SALT);
  assertEquals(decrypted, "test");
});
Deno.test("encrypt / decrypt - handles non-hex string secret (plain passphrase)", async () => {
  const passphrase = "my-short-passphrase";
  const encrypted = await encrypt("test", passphrase, SALT);
  const decrypted = await decrypt(encrypted, passphrase, SALT);
  assertEquals(decrypted, "test");
});

Deno.test("encryptEnvVars / decryptEnvVars - round-trips a record of env vars", async () => {
  const vars = { API_KEY: "sk-123", DB_URL: "postgres://localhost" };
  const json = await encryptEnvVars(vars, MASTER_SECRET, SALT);
  const decrypted = await decryptEnvVars(json, MASTER_SECRET, SALT);
  assertEquals(decrypted, vars);
});
Deno.test("encryptEnvVars / decryptEnvVars - round-trips an empty object", async () => {
  const json = await encryptEnvVars({}, MASTER_SECRET, SALT);
  const decrypted = await decryptEnvVars(json, MASTER_SECRET, SALT);
  assertEquals(decrypted, {});
});
Deno.test("encryptEnvVars / decryptEnvVars - rejects invalid JSON input", async () => {
  await assertRejects(async () => {
    await decryptEnvVars("not json", MASTER_SECRET, SALT);
  }, "encryptedJson is not valid JSON");
});
Deno.test("encryptEnvVars / decryptEnvVars - rejects JSON without expected EncryptedData shape", async () => {
  await assertRejects(async () => {
    await decryptEnvVars(JSON.stringify({ foo: "bar" }), MASTER_SECRET, SALT);
  }, "does not have expected EncryptedData shape");
});
Deno.test("encryptEnvVars / decryptEnvVars - rejects null JSON value", async () => {
  await assertRejects(async () => {
    await decryptEnvVars(JSON.stringify(null), MASTER_SECRET, SALT);
  }, "does not have expected EncryptedData shape");
});

Deno.test("maskEnvVars - masks short values completely", () => {
  assertEquals(maskEnvVars({ KEY: "short" }), { KEY: "****" });
});
Deno.test("maskEnvVars - masks long values showing first and last 2 chars", () => {
  assertEquals(maskEnvVars({ KEY: "1234567890" }), { KEY: "12****90" });
});
Deno.test("maskEnvVars - masks exactly 8-char values completely", () => {
  assertEquals(maskEnvVars({ KEY: "12345678" }), { KEY: "****" });
});
Deno.test("maskEnvVars - masks exactly 9-char values with partial reveal", () => {
  assertEquals(maskEnvVars({ KEY: "123456789" }), { KEY: "12****89" });
});
Deno.test("maskEnvVars - handles empty object", () => {
  assertEquals(maskEnvVars({}), {});
});
Deno.test("maskEnvVars - masks multiple keys independently", () => {
  const result = maskEnvVars({ A: "short", B: "a-long-secret-value" });
  assertEquals(result.A, "****");
  assertEquals(result.B, "a-****ue");
});
