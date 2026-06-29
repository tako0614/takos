import { describe, expect, test } from "bun:test";
import {
  decryptResourceSecretValue,
  encryptResourceSecretValue,
  isEncryptedResourceSecret,
} from "./secret-crypto.ts";

const KEY = "0".repeat(64); // 32-byte hex master secret

describe("resource secret at-rest crypto", () => {
  test("round-trips a value through encrypt/decrypt", async () => {
    const plaintext = "s3cr3t-token-value";
    const stored = await encryptResourceSecretValue(KEY, "res_1", plaintext);
    expect(stored).not.toBe(plaintext);
    expect(isEncryptedResourceSecret(stored)).toBe(true);
    const back = await decryptResourceSecretValue(KEY, "res_1", stored);
    expect(back).toBe(plaintext);
  });

  test("ciphertext differs per encryption (random IV)", async () => {
    const a = await encryptResourceSecretValue(KEY, "res_1", "same");
    const b = await encryptResourceSecretValue(KEY, "res_1", "same");
    expect(a).not.toBe(b);
    expect(await decryptResourceSecretValue(KEY, "res_1", a)).toBe("same");
    expect(await decryptResourceSecretValue(KEY, "res_1", b)).toBe("same");
  });

  test("decrypt passes through legacy plaintext unchanged", async () => {
    const legacy = "plain-legacy-token";
    expect(await decryptResourceSecretValue(KEY, "res_1", legacy)).toBe(legacy);
  });

  test("decrypt passes through non-ciphertext JSON unchanged", async () => {
    const jsonButNotCiphertext = JSON.stringify({ foo: "bar" });
    expect(await decryptResourceSecretValue(KEY, "res_1", jsonButNotCiphertext))
      .toBe(jsonButNotCiphertext);
  });

  test("no key configured: encrypt is a no-op and decrypt passes through", async () => {
    const plaintext = "token";
    const stored = await encryptResourceSecretValue(undefined, "res_1", plaintext);
    expect(stored).toBe(plaintext);
    expect(await decryptResourceSecretValue(undefined, "res_1", stored)).toBe(
      plaintext,
    );
  });

  test("wrong salt (different resource id) fails to decrypt", async () => {
    const stored = await encryptResourceSecretValue(KEY, "res_1", "token");
    await expect(
      decryptResourceSecretValue(KEY, "res_2", stored),
    ).rejects.toThrow();
  });

  test("empty value is returned unchanged", async () => {
    expect(await encryptResourceSecretValue(KEY, "res_1", "")).toBe("");
    expect(await decryptResourceSecretValue(KEY, "res_1", "")).toBe("");
  });
});
