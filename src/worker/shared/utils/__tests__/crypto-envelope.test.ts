import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  decryptEnvelope,
  encryptEnvelope,
  isEncryptedData,
} from "../crypto.ts";

/**
 * Guards the single-value envelope chokepoint that replaced the per-domain
 * `JSON.stringify(encrypt())` / `decrypt(JSON.parse() as EncryptedData)` copies.
 * decryptEnvelope must round-trip and must reject a malformed stored value up
 * front (the bare-cast sites previously leaned on decrypt's internal guard).
 */

const KEY = "0".repeat(64);
const SALT = "test:salt:v1";

test("encryptEnvelope/decryptEnvelope round-trips", async () => {
  const envelope = await encryptEnvelope("super-secret-token", KEY, SALT);
  // Canonical at-rest format is JSON of the EncryptedData shape.
  assertEquals(isEncryptedData(JSON.parse(envelope)), true);
  assertEquals(await decryptEnvelope(envelope, KEY, SALT), "super-secret-token");
});

test("decryptEnvelope rejects non-JSON", async () => {
  let threw = false;
  try {
    await decryptEnvelope("not-json", KEY, SALT);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

test("decryptEnvelope rejects a non-envelope JSON object", async () => {
  let threw = false;
  try {
    await decryptEnvelope(JSON.stringify({ foo: 1 }), KEY, SALT);
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

test("isEncryptedData validates the envelope shape", () => {
  assertEquals(
    isEncryptedData({ ciphertext: "x", iv: "y", alg: "AES-256-GCM", v: 1 }),
    true,
  );
  assertEquals(isEncryptedData({ ciphertext: "x", iv: "y" }), false);
  assertEquals(isEncryptedData({ ciphertext: "x", iv: "y", alg: "other", v: 1 }), false);
  assertEquals(isEncryptedData(null), false);
});
