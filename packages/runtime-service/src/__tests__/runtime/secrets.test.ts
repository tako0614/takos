import {
  collectSensitiveEnvValues,
  createSecretsSanitizer,
  mightExposeSecrets,
  SecretsSanitizer,
  shouldBlockForSecretExposure,
} from "../../runtime/actions/secrets.ts";

// ---------------------------------------------------------------------------
// SecretsSanitizer
// ---------------------------------------------------------------------------

import { assert, assertEquals, assertNotEquals } from "@std/assert";

Deno.test("SecretsSanitizer - sanitizes known secret values", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ API_KEY: "my-secret-key" });

  assertEquals(
    sanitizer.sanitize("token is my-secret-key here"),
    "token is *** here",
  );
});
Deno.test("SecretsSanitizer - sanitizes multiple secrets", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({
    KEY1: "secret1",
    KEY2: "secret2",
  });

  assertEquals(sanitizer.sanitize("secret1 and secret2"), "*** and ***");
});
Deno.test("SecretsSanitizer - handles empty secrets", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({});
  assertEquals(sanitizer.sanitize("no secrets here"), "no secrets here");
});
Deno.test("SecretsSanitizer - ignores empty string values in secrets", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ EMPTY: "" });
  assertEquals(sanitizer.sanitize("some text"), "some text");
});
Deno.test("SecretsSanitizer - returns input unchanged when no secrets registered", () => {
  const sanitizer = new SecretsSanitizer();
  assertEquals(sanitizer.sanitize("hello world"), "hello world");
});
Deno.test("SecretsSanitizer - returns empty string unchanged", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ KEY: "secret" });
  assertEquals(sanitizer.sanitize(""), "");
});
Deno.test("SecretsSanitizer - handles regex special characters in secrets", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ KEY: "special.chars+and*more" });

  assertEquals(
    sanitizer.sanitize("has special.chars+and*more in it"),
    "has *** in it",
  );
});
Deno.test("SecretsSanitizer - handles multiple occurrences of same secret", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ KEY: "abc" });

  assertEquals(sanitizer.sanitize("abc abc abc"), "*** *** ***");
});
Deno.test("SecretsSanitizer - sanitizes logs array", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ KEY: "secret" });

  const logs = ["line with secret", "clean line", "another secret"];
  const sanitized = sanitizer.sanitizeLogs(logs);
  assertEquals(sanitized, ["line with ***", "clean line", "another ***"]);
});
Deno.test("SecretsSanitizer - handles long secrets via string replacement fallback", () => {
  const longSecret = "a".repeat(5000);
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ KEY: longSecret });

  const text = `prefix ${longSecret} suffix`;
  assertEquals(sanitizer.sanitize(text), "prefix *** suffix");
});
Deno.test("SecretsSanitizer - registerSecretValues adds values", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecretValues(["val1", "val2"]);

  assertEquals(sanitizer.sanitize("val1 and val2"), "*** and ***");
});
Deno.test("SecretsSanitizer - clear removes all secrets", () => {
  const sanitizer = new SecretsSanitizer();
  sanitizer.registerSecrets({ KEY: "secret" });
  sanitizer.clear();

  assertEquals(sanitizer.sanitize("secret"), "secret");
});
// ---------------------------------------------------------------------------
// createSecretsSanitizer
// ---------------------------------------------------------------------------

Deno.test("createSecretsSanitizer - creates sanitizer with secrets", () => {
  const sanitizer = createSecretsSanitizer({ KEY: "value" });
  assertEquals(sanitizer.sanitize("the value is here"), "the *** is here");
});
Deno.test("createSecretsSanitizer - masks non-empty secrets regardless of length", () => {
  const sanitizer = createSecretsSanitizer({
    ONE: "x",
    THREE: "abc",
    EMPTY: "",
  });

  assertEquals(sanitizer.sanitize("x abc value"), "*** *** value");
});
Deno.test("createSecretsSanitizer - creates sanitizer with extra values", () => {
  const sanitizer = createSecretsSanitizer({}, ["extra"]);
  assertEquals(sanitizer.sanitize("extra text"), "*** text");
});
Deno.test("createSecretsSanitizer - creates sanitizer with both secrets and extras", () => {
  const sanitizer = createSecretsSanitizer({ KEY: "secret" }, ["extra"]);
  assertEquals(sanitizer.sanitize("secret and extra"), "*** and ***");
});
// ---------------------------------------------------------------------------
// mightExposeSecrets
// ---------------------------------------------------------------------------

Deno.test('mightExposeSecrets - detects bare "env" command', () => {
  assertNotEquals(mightExposeSecrets("env"), null);
  assertNotEquals(mightExposeSecrets("  env  "), null);
});
Deno.test('mightExposeSecrets - detects bare "printenv" command', () => {
  assertNotEquals(mightExposeSecrets("printenv"), null);
});
Deno.test('mightExposeSecrets - detects "export -p"', () => {
  assertNotEquals(mightExposeSecrets("export -p"), null);
});
Deno.test("mightExposeSecrets - returns null for safe commands", () => {
  assertEquals(mightExposeSecrets("echo hello"), null);
  assertEquals(mightExposeSecrets("npm install"), null);
});
Deno.test("mightExposeSecrets - returns null for env with arguments", () => {
  assertEquals(mightExposeSecrets("env VAR=value command"), null);
});
Deno.test("mightExposeSecrets - returns null for printenv with arguments", () => {
  assertEquals(mightExposeSecrets("printenv HOME"), null);
});
Deno.test("mightExposeSecrets - skips comment lines", () => {
  assertEquals(mightExposeSecrets("# env"), null);
});
Deno.test("mightExposeSecrets - skips empty lines", () => {
  assertEquals(mightExposeSecrets("\n\n"), null);
});
Deno.test("mightExposeSecrets - detects in multiline command", () => {
  assertNotEquals(mightExposeSecrets("echo hello\nenv"), null);
});
// ---------------------------------------------------------------------------
// shouldBlockForSecretExposure
// ---------------------------------------------------------------------------

Deno.test("shouldBlockForSecretExposure - blocks bare env", () => {
  assertEquals(shouldBlockForSecretExposure("env"), true);
});
Deno.test("shouldBlockForSecretExposure - does not block safe commands", () => {
  assertEquals(shouldBlockForSecretExposure("npm test"), false);
});
// ---------------------------------------------------------------------------
// collectSensitiveEnvValues
// ---------------------------------------------------------------------------

Deno.test("collectSensitiveEnvValues - returns empty array for undefined env", () => {
  assertEquals(collectSensitiveEnvValues(undefined), []);
});
Deno.test("collectSensitiveEnvValues - returns empty array for env with no sensitive keys", () => {
  assertEquals(collectSensitiveEnvValues({ CI: "true", NODE_ENV: "test" }), []);
});
Deno.test("collectSensitiveEnvValues - collects TAKOS_TOKEN value", () => {
  assertEquals(collectSensitiveEnvValues({ TAKOS_TOKEN: "tok123" }), [
    "tok123",
  ]);
});
Deno.test("collectSensitiveEnvValues - collects TAKOS_SESSION_ID value", () => {
  assertEquals(collectSensitiveEnvValues({ TAKOS_SESSION_ID: "sess123" }), [
    "sess123",
  ]);
});
Deno.test("collectSensitiveEnvValues - collects keys matching SECRET pattern", () => {
  assertEquals(collectSensitiveEnvValues({ MY_SECRET: "val" }), ["val"]);
});
Deno.test("collectSensitiveEnvValues - collects keys matching PASSWORD pattern", () => {
  assertEquals(collectSensitiveEnvValues({ DB_PASSWORD: "pass" }), ["pass"]);
});
Deno.test("collectSensitiveEnvValues - collects keys matching TOKEN pattern", () => {
  assertEquals(collectSensitiveEnvValues({ API_TOKEN: "tok" }), ["tok"]);
});
Deno.test("collectSensitiveEnvValues - collects keys matching API_KEY pattern", () => {
  assertEquals(collectSensitiveEnvValues({ MY_API_KEY: "key" }), ["key"]);
});
Deno.test("collectSensitiveEnvValues - collects keys matching AUTH pattern", () => {
  assertEquals(collectSensitiveEnvValues({ AUTH_HEADER: "bearer xyz" }), [
    "bearer xyz",
  ]);
});
Deno.test("collectSensitiveEnvValues - skips empty values", () => {
  assertEquals(collectSensitiveEnvValues({ MY_SECRET: "" }), []);
});
Deno.test("collectSensitiveEnvValues - collects multiple sensitive values", () => {
  const result = collectSensitiveEnvValues({
    TAKOS_TOKEN: "tok",
    MY_SECRET: "sec",
    SAFE_KEY: "safe",
  });
  assertEquals(result, ["tok", "sec"]);
  assert(!result.includes("safe"));
});
